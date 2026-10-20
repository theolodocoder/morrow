/**
 * The first shelf of open research (P-064): readable, varied PubMed Central articles. Each was CC BY when chosen; the
 * importer checks the licence again in the article itself and skips any that aren't CC BY or CC0.
 */
export const ARTICLES: { pmcid: string; tags: string[] }[] = [
  { pmcid: 'PMC10754334', tags: ['sleep', 'memory', 'neuroscience'] },
  { pmcid: 'PMC5122008', tags: ['bilingualism', 'ageing', 'language'] },
  { pmcid: 'PMC7723278', tags: ['oceans', 'microplastics', 'environment'] },
  { pmcid: 'PMC13669202', tags: ['reading', 'empathy', 'literature'] },
  { pmcid: 'PMC9663547', tags: ['bees', 'ecology'] },
  { pmcid: 'PMC7414190', tags: ['ancient dna', 'history', 'genetics'] },
  { pmcid: 'PMC12315648', tags: ['exercise', 'depression', 'health'] },
  { pmcid: 'PMC9182694', tags: ['coral', 'climate', 'oceans'] },
  { pmcid: 'PMC8472585', tags: ['music', 'genetics'] },
  { pmcid: 'PMC8942409', tags: ['microbiome', 'brain', 'health'] },
]

/** A tiny CC BY article in JATS, for tests and demos: imported with no network at all. */
export const SAMPLE_JATS = `<?xml version="1.0"?>
<article article-type="research-article">
<front>
<journal-meta><journal-title-group><journal-title>Journal of Quiet Studies</journal-title></journal-title-group></journal-meta>
<article-meta>
<article-id pub-id-type="pmcid">PMC0000001</article-id>
<article-id pub-id-type="doi">10.0000/quiet.0001</article-id>
<title-group><article-title>How lighthouse keepers slept</article-title></title-group>
<contrib-group>
<contrib contrib-type="author"><name><surname>Mensah</surname><given-names>Abena</given-names></name></contrib>
<contrib contrib-type="author"><name><surname>Lindqvist</surname><given-names>Erik</given-names></name></contrib>
</contrib-group>
<pub-date pub-type="epub"><year>2021</year></pub-date>
<permissions><license xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://creativecommons.org/licenses/by/4.0/"><license-p>This is an open access article under the CC BY license.</license-p></license></permissions>
<abstract><p>Keepers slept in <italic>short</italic> blocks through the night.</p></abstract>
</article-meta>
</front>
<body>
<sec><title>Introduction</title><p>Light had to be tended every four hours [<xref ref-type="bibr" rid="r1">1</xref>].</p></sec>
<sec><title>Methods</title><p>We read the logs of three lights.</p><list list-type="bullet"><list-item><p>North Head</p></list-item><list-item><p>Saltness</p></list-item></list>
<table-wrap><label>Table 1</label><caption><p>Hours slept</p></caption><table><tr><th>Light</th><th>Hours</th></tr><tr><td>North Head</td><td>5.5</td></tr></table></table-wrap></sec>
<sec><title>Results</title><p>Sleep came in <bold>two</bold> blocks.</p><fig><label>Figure 1.</label><caption><p>A keeper's night, hour by hour.</p></caption><graphic/></fig></sec>
<sec sec-type="supplementary-material"><title>Supplementary</title><p>Data file S1.</p></sec>
</body>
<back><ack><p>We thank the keepers' families.</p></ack>
<ref-list><ref id="r1"><element-citation><person-group><name><surname>Hale</surname><given-names>J</given-names></name></person-group><year>1890</year><article-title>The four-hour watch</article-title><source>Maritime Notes</source><pub-id pub-id-type="doi">10.0000/watch</pub-id><pub-id pub-id-type="pmid">123</pub-id></element-citation></ref></ref-list>
</back>
</article>`
