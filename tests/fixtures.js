'use strict';
function workspace() {
  return { schemaVersion: 1, config: { creativeControls: { length: '55', pacing: 'slow' } }, trackers: [{ name: 'status', path: '/stories/book' }], records: [
    { id: 'folder-1', path: '/stories', type: 'folder', creativeControls: { chaos: '20' } },
    { id: 'book-1', path: '/stories/book', type: 'book', creativeControls: { 'style-guide': 'Past tense' } },
    { id: 'chapter-1', path: '/stories/book/chapter', type: 'chapter', creativeControls: { tension: '70' } },
    { id: 'scene-1', path: '/stories/book/chapter/scene', type: 'scene', content: 'Mara walked into the garden.', creativeControls: { 'dialogue-share': '45' }, trackers: { status: 'draft' }, generationSettings: { endpoint: 'http://localhost:8080/v1' }, customLegacyField: { preserve: true } }
  ] };
}
module.exports = { workspace };
