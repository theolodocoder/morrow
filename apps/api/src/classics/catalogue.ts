import type { ClassicBook } from './store.ts'

/**
 * The first shelf of classics (P-063). Every author died long ago (before 1954) and every text is public domain in
 * the US; translations are the old public-domain ones. Descriptions are ours.
 */
export const CATALOGUE: ClassicBook[] = [
  {
    gutenbergId: 1342,
    title: 'Pride and Prejudice',
    author: 'Jane Austen',
    year: 1813,
    category: 'novel',
    tags: ['romance', 'classic', 'regency'],
    description: 'Elizabeth Bennet, Mr Darcy, and the first impressions that get everything wrong.',
  },
  {
    gutenbergId: 84,
    title: 'Frankenstein',
    author: 'Mary Shelley',
    year: 1818,
    category: 'novel',
    tags: ['gothic', 'science fiction', 'classic'],
    description: 'A young scientist makes a life, then runs from it. The first great science fiction novel.',
  },
  {
    gutenbergId: 11,
    title: 'Alice’s Adventures in Wonderland',
    author: 'Lewis Carroll',
    year: 1865,
    category: 'novella',
    tags: ['fantasy', 'children', 'classic'],
    description: 'Down the rabbit hole, into a world where nothing follows the rules.',
  },
  {
    gutenbergId: 345,
    title: 'Dracula',
    author: 'Bram Stoker',
    year: 1897,
    category: 'novel',
    tags: ['horror', 'gothic', 'classic'],
    description: 'Told in letters and diaries: a count from Transylvania comes to England.',
  },
  {
    gutenbergId: 98,
    title: 'A Tale of Two Cities',
    author: 'Charles Dickens',
    year: 1859,
    category: 'novel',
    tags: ['historical', 'revolution', 'classic'],
    description: 'London and Paris before and during the French Revolution. It was the best of times…',
  },
  {
    gutenbergId: 174,
    title: 'The Picture of Dorian Gray',
    author: 'Oscar Wilde',
    year: 1890,
    category: 'novel',
    tags: ['gothic', 'philosophy', 'classic'],
    description: 'A portrait ages so its subject doesn’t, and carries every one of his sins.',
  },
  {
    gutenbergId: 1661,
    title: 'The Adventures of Sherlock Holmes',
    author: 'Arthur Conan Doyle',
    year: 1892,
    category: 'collection',
    tags: ['mystery', 'detective', 'classic'],
    description: 'Twelve cases from 221B Baker Street.',
  },
  {
    gutenbergId: 1952,
    title: 'The Yellow Wallpaper',
    author: 'Charlotte Perkins Gilman',
    year: 1892,
    category: 'short_story',
    tags: ['gothic', 'feminism', 'classic'],
    description: 'A woman confined to a room, and the pattern she can’t stop seeing.',
  },
  {
    gutenbergId: 205,
    title: 'Walden',
    author: 'Henry David Thoreau',
    year: 1854,
    category: 'essay',
    tags: ['nature', 'philosophy', 'classic'],
    description: 'Two years in a cabin by a pond, and what it taught about living deliberately.',
  },
  {
    gutenbergId: 1080,
    title: 'A Modest Proposal',
    author: 'Jonathan Swift',
    year: 1729,
    category: 'essay',
    tags: ['satire', 'classic'],
    description: 'The most famous satirical essay in English, and still unsettling.',
  },
  {
    gutenbergId: 64317,
    title: 'The Great Gatsby',
    author: 'F. Scott Fitzgerald',
    year: 1925,
    category: 'novel',
    tags: ['jazz age', 'american', 'classic'],
    description: 'Long Island, 1922: a mysterious millionaire and the green light across the bay.',
  },
  {
    gutenbergId: 2701,
    title: 'Moby-Dick',
    author: 'Herman Melville',
    year: 1851,
    category: 'novel',
    tags: ['sea', 'adventure', 'classic'],
    description: 'Call me Ishmael. A whaling voyage, and a captain who will not let the white whale go.',
  },
]

/** A tiny public-domain sample (two short chapters), stored without any download: for tests and demos. */
export const SAMPLE_BOOK: ClassicBook = {
  gutenbergId: 999000,
  title: 'The Lighthouse Sampler',
  author: 'Anonymous',
  year: 1900,
  category: 'short_story',
  tags: ['classic', 'sample'],
  description: 'A short sample of how classics read on Morrow.',
}
export const SAMPLE_HTML = `<div>*** START OF THE PROJECT GUTENBERG EBOOK SAMPLE ***</div>
<h2>I. The Keeper</h2>
<p>The keeper climbed the stairs at dusk, as he had every evening for <i>forty</i> years.</p>
<p>Below him the sea went on arguing with the rocks.</p>
<h2>II. The Light</h2>
<p>When the lamp caught, the whole coast seemed to breathe out.</p>
<div>*** END OF THE PROJECT GUTENBERG EBOOK SAMPLE ***</div>`
