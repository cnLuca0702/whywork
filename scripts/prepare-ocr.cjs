// Reproducible local OCR data; no runtime downloads from the application.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib')
const models={eng:'7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',chi_sim:'a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730'}
async function main(){const dir=path.resolve(__dirname,'../resources/tessdata');fs.mkdirSync(dir,{recursive:true});for(const [lang,hash]of Object.entries(models)){
 const file=path.join(dir,lang+'.traineddata.gz');if(fs.existsSync(file)&&crypto.createHash('sha256').update(zlib.gunzipSync(fs.readFileSync(file))).digest('hex')===hash)continue
 const response=await fetch('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/'+lang+'.traineddata');if(!response.ok)throw new Error('OCR data download failed: '+response.status)
 const bytes=Buffer.from(await response.arrayBuffer());if(crypto.createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('OCR model checksum mismatch: '+lang)
 fs.writeFileSync(file,zlib.gzipSync(bytes));console.log('Prepared '+lang)
}}
main().catch(e=>{console.error(e.message);process.exitCode=1})
