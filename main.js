const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const Jimp = require('jimp');

require('@electron/remote/main').initialize();

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  require('@electron/remote/main').enable(win.webContents);
  await win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function textToBinary(text) {
  return text.split('').map(char => 
    char.charCodeAt(0).toString(2).padStart(8, '0')
  ).join('');
}

function binaryToText(binary) {
  const bytes = binary.match(/.{8}/g) || [];
  return bytes.map(byte => 
    String.fromCharCode(parseInt(byte, 2))
  ).join('');
}

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('encode-text', async (event, { imagePath, text }) => {
  try {
    const image = await Jimp.read(imagePath);
    const binaryMessage = textToBinary(text);
    const maxMessageLength = (image.getWidth() * image.getHeight() * 3) - 32;
    
    if (binaryMessage.length > maxMessageLength) {
      throw new Error('Message is too long for this image');
    }
    
    const messageLengthBinary = binaryMessage.length.toString(2).padStart(32, '0');
    let bitIndex = 0;
    
    for (let i = 0; i < 32; i++) {
      const x = i % image.getWidth();
      const y = Math.floor(i / image.getWidth());
      const pixel = Jimp.intToRGBA(image.getPixelColor(x, y));
      pixel.r = (pixel.r & 0xFE) | parseInt(messageLengthBinary[i]);
      image.setPixelColor(Jimp.rgbaToInt(pixel.r, pixel.g, pixel.b, pixel.a), x, y);
    }
    
    for (let i = 0; i < binaryMessage.length; i++) {
      const x = (i + 32) % image.getWidth();
      const y = Math.floor((i + 32) / image.getWidth());
      const pixel = Jimp.intToRGBA(image.getPixelColor(x, y));
      pixel.r = (pixel.r & 0xFE) | parseInt(binaryMessage[i]);
      image.setPixelColor(Jimp.rgbaToInt(pixel.r, pixel.g, pixel.b, pixel.a), x, y);
    }
    
    const savePath = await dialog.showSaveDialog({
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    });
    
    if (!savePath.canceled) {
      await image.writeAsync(savePath.filePath);
      dialog.showMessageBox({ type: 'info', message: 'Message encoded successfully!' });
    }
  } catch (error) {
    throw new Error(`Failed to encode message: ${error.message}`);
  }
});

ipcMain.handle('decode-text', async (event, imagePath) => {
  try {
    const image = await Jimp.read(imagePath);
    let messageLengthBinary = '';
    
    for (let i = 0; i < 32; i++) {
      const x = i % image.getWidth();
      const y = Math.floor(i / image.getWidth());
      const pixel = Jimp.intToRGBA(image.getPixelColor(x, y));
      messageLengthBinary += pixel.r & 1;
    }
    
    const messageLength = parseInt(messageLengthBinary, 2);
    if (messageLength <= 0 || messageLength > (image.getWidth() * image.getHeight() * 3) - 32) {
      throw new Error('No valid message found in image');
    }
    
    let binaryMessage = '';
    for (let i = 0; i < messageLength; i++) {
      const x = (i + 32) % image.getWidth();
      const y = Math.floor((i + 32) / image.getWidth());
      const pixel = Jimp.intToRGBA(image.getPixelColor(x, y));
      binaryMessage += pixel.r & 1;
    }
    
    return binaryToText(binaryMessage);
  } catch (error) {
    throw new Error(`Failed to decode message: ${error.message}`);
  }
});