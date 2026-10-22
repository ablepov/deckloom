// Neutral, explicitly marked HTML. It is the sole source for every export format.
const bodies = {
  text: '<div id="title" data-deckloom-pptx="text" style="left:48px;top:40px;width:864px;height:64px;font-size:40px;line-height:48px;font-weight:700">Кириллица — проверка переноса</div><div id="body" data-deckloom-pptx="text" style="left:48px;top:142px;width:630px;height:300px"><span style="font-weight:700">Съёмка и ёжик: </span>обычный текст переносится внутри заданной ширины. <span style="font-style:italic">Курсив сохраняет смысл и начертание.</span><br><span style="text-decoration:underline">Вторая строка — явный перенос. </span>Проверяем буквы ё, й, щ и «кавычки».</div>',
  layers:
    '<div id="title" data-deckloom-pptx="text" style="left:48px;top:40px;width:864px;height:64px;font-size:40px;line-height:48px;font-weight:700">Фигуры, текст и порядок слоёв</div><div id="back" data-deckloom-pptx="rect" style="left:64px;top:150px;width:500px;height:200px;background:#2456a6"></div><div id="back-label" data-deckloom-pptx="text" style="left:88px;top:176px;width:440px;height:70px;color:white">Задний слой — синий</div><div id="front" data-deckloom-pptx="rect" style="left:464px;top:260px;width:300px;height:170px;background:#f2ae49"></div><div id="front-label" data-deckloom-pptx="text" style="left:488px;top:288px;width:250px;height:110px">Передний слой<br>с отдельным текстом</div>',
  media:
    '<div id="title" data-deckloom-pptx="text" style="left:48px;top:40px;width:864px;height:64px;font-size:40px;line-height:48px;font-weight:700">Локальное изображение и SVG</div><img id="raster" data-deckloom-pptx="image" src="../../export-assets/pptx-marker.png" alt="PNG" style="left:80px;top:160px;width:180px;height:180px"><img id="vector" data-deckloom-pptx="image" src="../../export-assets/pptx-marker.svg" alt="SVG" style="left:420px;top:160px;width:180px;height:180px"><div id="raster-label" data-deckloom-pptx="text" style="left:80px;top:380px;width:300px;height:70px">PNG — изображение</div><div id="vector-label" data-deckloom-pptx="text" style="left:420px;top:380px;width:400px;height:70px">SVG — векторный ресурс</div>',
};
module.exports = {
  contractVersion: 1,
  id: 'pptx-neutral',
  mode: 'registered',
  root: __dirname,
  decks: [
    { id: 'main', label: 'Editable PPTX', width: 960, height: 540, slides: Object.keys(bodies).map((id) => ({ id })) },
  ],
  renderDocument(deck, slide) {
    return (
      '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}main{position:relative;width:960px;height:540px;background:#f4f1e9}main>div,main>img{position:absolute;overflow:visible}div{font:28px/36px Arial;color:#17221c;white-space:pre-wrap;text-align:left;margin:0;padding:0}</style></head><body><main class="slide" data-deckloom-pptx="slide">' +
      bodies[slide.id] +
      '</main></body></html>'
    );
  },
};
