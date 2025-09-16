// train.js
const { trainFromDisk, getModelStatus } = require('./ml');

(async () => {
  const info = await trainFromDisk();
  console.log('Treinado:', info);
  console.log('Status:', getModelStatus());
})();
