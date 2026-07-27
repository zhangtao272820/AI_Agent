/**
 * PPTX ingestion smoke (no LLM / no vector store).
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { extractPptxText, isLegacyPptOle } from '../server/utils/pptx_text'

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-smoke-'))
const pptxPath = path.join(tmp, 'sample.pptx')

const zip = new AdmZip()
const slide1 = `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><a:t>探视制度</a:t><a:t>下午两点</a:t></p:sp></p:spTree></p:cSld></p:sld>`
const slide2 = `<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><a:t>登记入场</a:t></p:sp></p:spTree></p:cSld></p:sld>`
zip.addFile('[Content_Types].xml', Buffer.from('<Types></Types>'))
zip.addFile('ppt/slides/slide1.xml', Buffer.from(slide1, 'utf8'))
zip.addFile('ppt/slides/slide2.xml', Buffer.from(slide2, 'utf8'))
zip.writeZip(pptxPath)

const buf = await fs.readFile(pptxPath)
const text = await extractPptxText(buf)
assert(text.includes('探视制度'), 'slide1 text')
assert(text.includes('登记入场'), 'slide2 text')
assert(text.indexOf('Slide 1:') < text.indexOf('Slide 2:'), 'slide order')
assert(isLegacyPptOle(Buffer.from('d0cf11e0', 'hex')), 'legacy ppt magic')

await fs.rm(tmp, { recursive: true, force: true })
console.log('smoke: pptx ok')
