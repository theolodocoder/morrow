/**
 * Weekly prompts (P-059): one a week for everyone, Monday to Sunday (UTC), from a list that loops. Entries are works
 * tagged with the week's tag (`prompt-2026-w43`), so they're found the way every other topic is.
 */
const PROMPTS: { title: string; body: string }[] = [
  { title: 'The letter that arrived too late', body: 'Someone finally reads it. What does it change now?' },
  { title: 'A door that wasn’t there yesterday', body: 'Open it, or don’t. Either way, something follows.' },
  { title: 'The last person who remembers', body: 'A memory held by one person. What happens to it next?' },
  { title: 'Weather as a character', body: 'Let the storm, the drought or the fog want something.' },
  { title: 'An ordinary object, kept for years', body: 'Why it was kept says everything about who kept it.' },
  { title: 'Two people, one secret, a long drive', body: 'Nobody can leave the car.' },
  { title: 'Write the morning after', body: 'Skip the big event. Begin where the quiet starts.' },
  { title: 'A map with one place left blank', body: 'Who left it blank, and who goes to find out?' },
  { title: 'What the city sounds like at 4 a.m.', body: 'A poem, an essay or a scene: listen first.' },
  { title: 'An argument you lost and still think about', body: 'Make the case again. Maybe you were right.' },
  { title: 'Inheritance', body: 'Something passed down that nobody asked for.' },
  { title: 'The smallest act of courage', body: 'No battles. Just one hard thing done anyway.' },
  { title: 'A recipe that tells a family story', body: 'Ingredients, steps, and everything between them.' },
  { title: 'The year everything changed', body: 'Fiction or memoir. Begin with the first sign.' },
  {
    title: 'Explain something you love to a stranger',
    body: 'An essay, a lesson or a love letter to a subject.',
  },
  { title: 'A town where it never gets dark', body: 'What do people do with no night?' },
  { title: 'The apprentice', body: 'Someone learning a craft from someone who won’t say everything.' },
  { title: 'Lost in translation', body: 'A misunderstanding between languages, or generations.' },
  { title: 'What the sea gave back', body: 'Something washes up. It shouldn’t exist.' },
  { title: 'A list poem', body: 'Ten things, in order, that add up to more than ten.' },
  { title: 'The rival', body: 'Two people who make each other better by refusing to lose.' },
  {
    title: 'Home, from the outside',
    body: 'Describe where you’re from as someone arriving for the first time.',
  },
  { title: 'A question science can’t answer yet', body: 'Write the case for why it matters.' },
  { title: 'The day the machines stopped', body: 'Not a disaster story: what do people rediscover?' },
  { title: 'A promise kept for the wrong reasons', body: 'Was it still worth keeping?' },
  { title: 'Market day', body: 'Voices, prices, bargains and one stranger who doesn’t fit.' },
  { title: 'Begin at the end', body: 'Your first line is the last thing that happens.' },
  { title: 'A conversation overheard', body: 'Only half of it. Write the rest.' },
  { title: 'Small gods', body: 'The spirit of a bus stop, a kitchen, a shared phone.' },
  { title: 'Teach me something in 500 words', body: 'A guide, a lesson, a how-to with heart.' },
  { title: 'The photograph', body: 'Someone is in it who shouldn’t be.' },
  { title: 'An unsent reply', body: 'Answer a message you never answered.' },
  { title: 'Borders', body: 'A line on a map, a line between people, a line you crossed.' },
  { title: 'The night shift', body: 'People who work while everyone else sleeps.' },
  { title: 'A myth retold', body: 'Take an old story and tell it from the side nobody tells.' },
  {
    title: 'What we owe the future',
    body: 'An essay, a letter to someone not yet born, or a story set there.',
  },
  { title: 'Two versions of the same day', body: 'Branch it: what if one choice went the other way?' },
  { title: 'Hands', body: 'A story told only through what someone’s hands do.' },
  { title: 'A festival', body: 'Noise, colour, family and one quiet moment inside it.' },
  { title: 'The thing nobody says out loud', body: 'Every family, office or town has one. Say it.' },
  { title: 'Where the road ends', body: 'And what people built there anyway.' },
  { title: 'A mentor’s last lesson', body: 'The one they saved until the end.' },
  { title: 'Rain in a dry place', body: 'What it means when it finally comes.' },
  { title: 'Write it together', body: 'Start a piece and invite someone to write the next part.' },
  { title: 'The impostor', body: 'Someone pretending to be someone. Maybe it’s you.' },
  { title: 'A field guide to an invented place', body: 'Its plants, its animals, its manners.' },
  { title: 'The long goodbye', body: 'A leaving that takes years.' },
  { title: 'One small discovery', body: 'Research, observation or a story about noticing.' },
  { title: 'The voice on the radio', body: 'Every night at the same time. Then one night, silence.' },
  { title: 'Celebration', body: 'Write joy without irony.' },
  { title: 'Looking back from 2075', body: 'What did we get right? What do they wish we’d done?' },
  { title: 'Free week', body: 'Write the thing you’ve been putting off.' },
]

const WEEK_MS = 7 * 86_400_000
// Monday 2024-01-01, so weeks start on Mondays (UTC)
const EPOCH = Date.UTC(2024, 0, 1)

export function promptFor(now = Date.now()) {
  const index = Math.floor((now - EPOCH) / WEEK_MS)
  const start = new Date(EPOCH + index * WEEK_MS)
  const end = new Date(start.getTime() + WEEK_MS)
  // ISO-style week label from the Monday: year + week number within the year
  const yearStart = Date.UTC(start.getUTCFullYear(), 0, 1)
  const week = Math.floor((start.getTime() - yearStart) / WEEK_MS) + 1
  const label = `${start.getUTCFullYear()}-w${String(week).padStart(2, '0')}`
  const p = PROMPTS[((index % PROMPTS.length) + PROMPTS.length) % PROMPTS.length]!
  return { ...p, tag: `prompt-${label}`, startsAt: start.toISOString(), endsAt: end.toISOString() }
}
