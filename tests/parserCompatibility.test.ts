import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { parseDocx } from '../electron/services/parsers/docxParser'
import { parseEpub } from '../electron/services/parsers/epubParser'
import { parseHtml } from '../electron/services/parsers/htmlParser'
import { parseMarkdown } from '../electron/services/parsers/mdParser'
import { parsePdf } from '../electron/services/parsers/pdfParser'
import { parseTxt } from '../electron/services/parsers/txtParser'

const root = mkdtempSync(join(tmpdir(), 'ting-ear-parser-'))
let passed = 0

async function test(name: string, run: () => void | Promise<void>): Promise<void> {
  await run()
  passed++
  console.log(`  ok ${name}`)
}

function createEpub(
  filePath: string,
  body = '<h1>第一章</h1><p>第一句。</p><p>第二句！</p>'
): void {
  const zip = new AdmZip()
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'
    )
  )
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(
      '<?xml version="1.0"?><package><metadata><dc:title>EPUB 标题</dc:title><dc:creator>作者</dc:creator></metadata><manifest><item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>'
    )
  )
  zip.addFile('OEBPS/chapter.xhtml', Buffer.from(`<html><body>${body}</body></html>`))
  zip.writeZip(filePath)
}

function createDocx(filePath: string, text = '文档标题。第一句。第二句！'): void {
  const zip = new AdmZip()
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    )
  )
  zip.addFile(
    '_rels/.rels',
    Buffer.from(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    )
  )
  zip.addFile(
    'word/document.xml',
    Buffer.from(
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
    )
  )
  zip.writeZip(filePath)
}

async function main(): Promise<void> {
  console.log('\nParser compatibility')

  try {
    await test('keeps valid UTF-8 Chinese in TXT and Markdown', () => {
      const txtPath = join(root, 'utf8.txt')
      const mdPath = join(root, 'utf8.md')
      writeFileSync(txtPath, '中文标题\n\x82；\n第一句。第二句！', 'utf8')
      writeFileSync(mdPath, '# 中文标题\n\x82；\n第一句。第二句！', 'utf8')
      assert.ok(parseTxt(txtPath).sentences.some((sentence) => sentence.includes('第一句')))
      const markdown = parseMarkdown(mdPath)
      assert.equal(markdown.title, '中文标题')
      assert.ok(markdown.sentences.every((sentence) => !sentence.includes('涓')))
      assert.ok(markdown.sentences.every((sentence) => !sentence.includes('\x82')))
    })

    await test('ignores HTML script/style text and decodes numeric entities', () => {
      const htmlPath = join(root, 'book.html')
      writeFileSync(
        htmlPath,
        '<html><head><title>网页标题</title><style>.bad{color:red}</style></head><body><script>console.log("bad")</script><h1>正文</h1><p>&#20013;&#25991;第一句。</p></body></html>',
        'utf8'
      )
      const parsed = parseHtml(htmlPath)
      assert.equal(parsed.title, '网页标题')
      assert.ok(parsed.sentences.some((sentence) => sentence.includes('中文第一句')))
      assert.ok(parsed.sentences.every((sentence) => !/console|color:red/.test(sentence)))
    })

    await test('parses minimal EPUB and DOCX packages', async () => {
      const epubPath = join(root, 'book.epub')
      const docxPath = join(root, 'book.docx')
      createEpub(epubPath, '<h1>第一章</h1><p>\x82；</p><p>第一句。</p><p>第二句！</p>')
      createDocx(docxPath, '文档标题。\u200b；第一句。第二句！')
      const epub = await parseEpub(epubPath, root)
      const docx = await parseDocx(docxPath)
      assert.equal(epub.title, 'EPUB 标题')
      assert.ok(epub.sentences.join('').includes('第一句。第二句！'))
      assert.ok(epub.sentences.every((sentence) => !sentence.includes('\x82')))
      assert.ok(docx.sentences.join('').includes('第一句。第二句！'))
    })

    await test('handles empty fixtures without persisting broken parser output', async () => {
      const txtPath = join(root, 'empty.txt')
      const mdPath = join(root, 'empty.md')
      const htmlPath = join(root, 'empty.html')
      const epubPath = join(root, 'empty.epub')
      const docxPath = join(root, 'empty.docx')
      writeFileSync(txtPath, '；\n——\n\x82', 'utf8')
      writeFileSync(mdPath, '；\n——\n\x82', 'utf8')
      writeFileSync(htmlPath, '<html><body><p>；——</p></body></html>', 'utf8')
      createEpub(epubPath, '<p>；——</p>')
      createDocx(docxPath, '；——')

      assert.equal(parseTxt(txtPath).sentences.length, 0)
      assert.equal(parseMarkdown(mdPath).sentences.length, 0)
      assert.equal(parseHtml(htmlPath).sentences.length, 0)
      await assert.rejects(parseEpub(epubPath, root), /无法.*文本/)
      assert.equal((await parseDocx(docxPath)).sentences.length, 0)
    })

    await test('reports a useful error for a malformed PDF', async () => {
      const pdfPath = join(root, 'broken.pdf')
      writeFileSync(pdfPath, '%PDF-1.4\nnot-a-valid-pdf', 'utf8')
      await assert.rejects(parsePdf(pdfPath), /PDF|损坏|无效/)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }

  console.log(`Parser compatibility result: ${passed} passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
