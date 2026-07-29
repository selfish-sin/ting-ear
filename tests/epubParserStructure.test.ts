import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { parseEpub, parseXhtmlToBlocks } from '../electron/services/parsers/epubParser'

console.log('\nEPUB structure')

const blocks = parseXhtmlToBlocks(`
  <html><body>
    <h1>章标题</h1>
    <p>开始<em>强调</em>与<strong>粗体</strong>结束。</p>
    <blockquote>引用内容。</blockquote>
    <ul><li>第一项。</li><li>第二项。</li></ul>
    <aside epub:type="footnote">脚注内容。</aside>
  </body></html>
`)

assert.ok(blocks)
assert.deepEqual(blocks.map((block) => block.type), [
  'heading',
  'paragraph',
  'quote',
  'list',
  'list',
  'footnote'
])
assert.match(blocks[1].text, /开始.*强调.*粗体.*结束/)
assert.equal(blocks[5].ttsSkip, true)
console.log('  ok preserves document order, nested inline text, and footnote metadata')

const attributedFootnotes = parseXhtmlToBlocks(`
  <html><body>
    <p epub:type="footnote">双引号 epub:type 脚注。</p>
    <p class="footnote note">双引号 class 脚注。</p>
  </body></html>
`)
assert.ok(attributedFootnotes)
assert.deepEqual(attributedFootnotes.map((block) => block.type), ['footnote', 'footnote'])
assert.ok(attributedFootnotes.every((block) => block.ttsSkip))
console.log('  ok recognizes double-quoted epub:type and class footnotes')

const mixedContainers = parseXhtmlToBlocks(`
  <html><body>
    <p>正文。</p>
    <div class="footnote">脚注。</div>
    <section><p>容器正文。</p></section>
    <code>独立代码。</code>
  </body></html>
`)
assert.ok(mixedContainers)
assert.deepEqual(mixedContainers.map((block) => block.type), [
  'paragraph',
  'footnote',
  'paragraph',
  'code'
])
assert.deepEqual(mixedContainers.map((block) => block.text), [
  '正文。',
  '脚注。',
  '容器正文。',
  '独立代码。'
])
assert.equal(mixedContainers[1].ttsSkip, true)
console.log('  ok preserves mixed containers and standalone code without dropping text')

async function verifyGlobalRanges(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'ting-ear-epub-structure-'))
  try {
  const epubPath = join(root, 'two-chapters.epub')
  // 每章需要 ≥ CHAPTER_MIN_SENTENCES(35) 句，否则会被 min 合并为 1 章
  const makeChapterHtml = (heading: string, prefix: string): string => {
    const paras = Array.from({ length: 40 }, (_, i) => `<p>${prefix}正文第${i + 1}句。</p>`).join('')
    return `<html><body><h1>${heading}</h1>${paras}</body></html>`
  }
  const zip = new AdmZip()
  zip.addFile(
    'META-INF/container.xml',
    Buffer.from(
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'
    )
  )
  zip.addFile(
    'OEBPS/content.opf',
    Buffer.from(`<?xml version="1.0"?>
      <package>
        <metadata><dc:title>跨章测试</dc:title><dc:creator>测试作者</dc:creator></metadata>
        <manifest>
          <item id="c1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
          <item id="c2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
      </package>`)
  )
  zip.addFile(
    'OEBPS/chapter-1.xhtml',
    Buffer.from(makeChapterHtml('第一章', '一'))
  )
  zip.addFile(
    'OEBPS/chapter-2.xhtml',
    Buffer.from(makeChapterHtml('第二章', '二'))
  )
  zip.writeZip(epubPath)

    const parsed = await parseEpub(epubPath, root)
    assert.equal(parsed.structure?.length, 2)
    const [first, second] = parsed.structure!
    assert.equal(first.sentenceRange[0], 0)
    assert.equal(second.sentenceRange[0], first.sentenceRange[1])
    assert.equal(second.sentenceRange[1], parsed.sentences.length)
    assert.ok(second.blocks.every((block) => block.sentenceRange[0] >= second.sentenceRange[0]))
    assert.deepEqual(
      parsed.chapters.map((chapter) => [chapter.startIndex, chapter.sentenceCount]),
      parsed.structure!.map((chapter) => [
        chapter.sentenceRange[0],
        chapter.sentenceRange[1] - chapter.sentenceRange[0]
      ])
    )
    console.log('  ok offsets chapter and block ranges into the global sentence array')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function verifyPackageXmlAttributeVariants(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'ting-ear-epub-package-'))
  try {
    const epubPath = join(root, 'attribute-variants.epub')
    const zip = new AdmZip()
    zip.addFile(
      'META-INF/container.xml',
      Buffer.from(
        "<?xml version='1.0'?><container><rootfiles><rootfile media-type='application/oebps-package+xml' full-path='OPS/package.opf'/></rootfiles></container>"
      )
    )
    zip.addFile(
      'OPS/package.opf',
      Buffer.from(`<?xml version='1.0'?>
        <package xmlns:dc='http://purl.org/dc/elements/1.1/'>
          <metadata><dc:title>Package variants</dc:title><dc:creator>Test author</dc:creator></metadata>
          <manifest>
            <item media-type='application/xhtml+xml' href='one.xhtml' id='one'/>
            <item href='two.xhtml' media-type='application/xhtml+xml' id='two'/>
          </manifest>
          <spine><itemref linear='yes' idref='one'/><itemref idref='two' linear='yes'/></spine>
        </package>`)
    )
    // 每章 ≥ CHAPTER_MIN_SENTENCES(35) 句，避免被 min 合并；首段保留原文本用于断言
    const fillParas = (prefix: string): string =>
      Array.from({ length: 40 }, (_, i) => `<p>${prefix} 填充句 ${i + 1}。</p>`).join('')
    zip.addFile(
      'OPS/one.xhtml',
      Buffer.from(`<html><body><p>First chapter.</p>${fillParas('一')}</body></html>`)
    )
    zip.addFile(
      'OPS/two.xhtml',
      Buffer.from(`<html><body><p>Second chapter.</p>${fillParas('二')}</body></html>`)
    )
    zip.writeZip(epubPath)

    const parsed = await parseEpub(epubPath, root)
    assert.equal(parsed.title, 'Package variants')
    assert.equal(parsed.author, 'Test author')
    assert.equal(parsed.structure?.length, 2)
    assert.deepEqual(parsed.structure?.map((chapter) => chapter.blocks[0].text), [
      'First chapter.',
      'Second chapter.'
    ])
    console.log('  ok parses single-quoted and reordered package attributes')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function verifyDenseTocRegrouping(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'ting-ear-epub-dense-toc-'))
  try {
    const epubPath = join(root, 'dense-toc.epub')
    const count = 420
    const body = Array.from({ length: count }, (_, index) =>
      `<h2 id="anchor-${index}">小节 ${index + 1}</h2><p>这是第 ${index + 1} 个段落，包含足够的正文内容用于章节归并测试。</p>`
    ).join('')
    const navPoints = Array.from({ length: count }, (_, index) =>
      `<navPoint id="nav-${index}" playOrder="${index + 1}"><navLabel><text>小节 ${index + 1}</text></navLabel><content src="chapter.xhtml#anchor-${index}"/></navPoint>`
    ).join('')
    const zip = new AdmZip()
    zip.addFile(
      'META-INF/container.xml',
      Buffer.from('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
    )
    zip.addFile(
      'OEBPS/content.opf',
      Buffer.from(`<?xml version="1.0"?>
        <package>
          <metadata><dc:title>Dense TOC</dc:title></metadata>
          <manifest>
            <item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
            <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
          </manifest>
          <spine toc="ncx"><itemref idref="c1"/></spine>
        </package>`)
    )
    zip.addFile('OEBPS/toc.ncx', Buffer.from(`<?xml version="1.0"?><ncx><navMap>${navPoints}</navMap></ncx>`))
    zip.addFile('OEBPS/chapter.xhtml', Buffer.from(`<html><body>${body}</body></html>`))
    zip.writeZip(epubPath)

    const parsed = await parseEpub(epubPath, root)
    assert.ok(parsed.structure)
    // 导入默认 original：保留 TOC 粒度（不过 min35 合并），合并留给预选页。
    // 420 个锚点应基本都保留；sourceBoundaries 记录原料。
    assert.ok(
      parsed.structure.length >= 100,
      `expected dense original TOC chapters, got ${parsed.structure.length}`
    )
    assert.ok(
      (parsed.sourceBoundaries?.length ?? 0) >= 100,
      'sourceBoundaries should capture raw TOC anchors'
    )
    assert.ok(parsed.structure.some((chapter) => chapter.blocks.some((block) => block.type === 'heading')))
    assert.deepEqual(
      parsed.chapters.map((chapter) => [chapter.startIndex, chapter.sentenceCount]),
      parsed.structure.map((chapter) => [chapter.sentenceRange[0], chapter.sentenceRange[1] - chapter.sentenceRange[0]])
    )
    assert.equal(parsed.structure[0].sentenceRange[0], 0)
    assert.equal(parsed.structure.at(-1)?.sentenceRange[1], parsed.sentences.length)
    console.log('  ok keeps dense TOC anchors in original import mode')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

void (async () => {
  await verifyGlobalRanges()
  await verifyPackageXmlAttributeVariants()
  await verifyDenseTocRegrouping()
  console.log('EPUB structure result: 6 passed')
})()
