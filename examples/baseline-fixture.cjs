const path = require('node:path');
const demo = require('./deckloom.config.cjs');

// A neutral workload, not a golden image or a platform-specific performance budget.
function createBaselineProject({ root = path.join(__dirname, '../output/baseline'), largeSlides = 120 } = {}) {
  if (!Number.isInteger(largeSlides) || largeSlides < 1 || largeSlides > 500) {
    throw new Error('largeSlides must be an integer from 1 to 500');
  }
  const decks = JSON.parse(JSON.stringify(demo.decks));
  decks[0].slides[0].name = 'Презентация «Deckloom»';
  decks[0].slides[0].content = 'Текст, кавычки и тире — в обычном HTML';
  decks.push({
    id: 'large', label: 'Large neutral deck', artifactPrefix: 'large-slide', width: 1280, height: 720,
    slides: Array.from({ length: largeSlides }, (_, index) => ({
      no: String(index + 1).padStart(3, '0'), name: `Slide ${index + 1}`,
      content: `Neutral example ${index + 1} of ${largeSlides}`,
    })),
  });
  return { ...demo, root: path.resolve(root), decks, viewer: { title: 'Deckloom baseline', storagePrefix: 'deckloom-baseline' } };
}

module.exports = { createBaselineProject };
