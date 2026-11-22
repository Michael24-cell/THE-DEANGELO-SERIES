// Single source of product display data, shared by product.html,
// collection.html (loaded as a classic <script>) and functions/product.js /
// functions/collection.js (imported for its side effect), so the server-
// rendered HTML and the in-browser render can never disagree.
// Trusted pricing/fulfillment data lives in functions/_lib/catalog.js, not here.
(function (g) {
  // Pieces with a mockup image but no confirmed artwork, pricing, or sizing yet.
  // Rendered in a stripped-down "preview" mode below — no invented details.
  var PREVIEWS = {
    ostiaantica:         { title:'Ostia Antica',            img:'img/ostia-antica.webp' },
    'verona-oat':        { title:'Verona', sub:'Oat',      img:'img/verona-oat.webp' },
    'verona-black':      { title:'Verona', sub:'Black',    img:'img/verona-black.webp' },
    'new-york-chrysler': { title:'New York Chrysler',       img:'img/new-york-chrysler-hoodie.webp' }
  };

  // Third gallery image/thumb, alongside the existing Model/Flat shots.
  // What it shows (and its label) varies per garment:
  //  - Tees: the front-of-garment wordmark flat-lay, one photo per color
  //    ("Front"). Cream/Oatmeal have no front photography of their own
  //    yet, so they reuse White (same pattern as their back-print
  //    model/flat shots).
  //  - Venezia Crewneck specifically: Model/Flat above show the FRONT of
  //    the garment (wordmark) by default and its flat lay — this third
  //    slot instead shows the back-print model shot ("Back").
  //  - The other artworks' crewnecks show a front-of-garment wordmark
  //    shot ("Front") where one has been photographed — see
  //    CREW_FRONT_IMAGE below, keyed by slug (and by color for products
  //    where only one color has a front shot so far). Everything else
  //    returns null (no third photo — the caller hides that frame
  //    entirely) until one exists.
  var FRONT_IMAGE_BY_COLOR = {
    White: 'img/deangelo-series-front-white.webp',
    Black: 'img/deangelo-series-front-black.webp',
    Cream: 'img/deangelo-series-front-white.webp',
    Oatmeal: 'img/deangelo-series-front-white.webp',
  };
  var CREW_BACK_IMAGE_BY_COLOR = {
    White: 'img/venezia-crew-model-back.webp',
    Black: 'img/venezia-black-crew-model.webp',
  };
  var CREW_FRONT_IMAGE = {
    'wind-sea-crew': 'img/black-crew-gold-type-front.webp',
    'villa-d-este-crew': 'img/black-crew-gold-type-front.webp',
    'arhus-old-town-crew': 'img/black-crew-white-type.webp',
    'waves-of-life-crew': { White: 'img/white-crew-black-text.webp', Black: 'img/black-crew-white-type.webp' },
    'palatine-hill-crew': { White: 'img/white-crew-black-text.webp' },
  };
  function thirdImageFor(p, colorName, slug) {
    if (p.garment === 'Crewneck' && p.title === 'Venezia') {
      var backSrc = CREW_BACK_IMAGE_BY_COLOR[colorName] || CREW_BACK_IMAGE_BY_COLOR.White;
      return { src: backSrc, label: 'Back' };
    }
    if (p.garment === 'Crewneck') {
      var frontSpec = CREW_FRONT_IMAGE[slug];
      var frontSrc = typeof frontSpec === 'string' ? frontSpec : (frontSpec && frontSpec[colorName]);
      return frontSrc ? { src: frontSrc, label: 'Front' } : null;
    }
    return { src: FRONT_IMAGE_BY_COLOR[colorName] || FRONT_IMAGE_BY_COLOR.White, label: 'Front' };
  }

  var PRODS = {
    tee:    { title:'Venezia', artwork:'Artwork 01', plate:'01', garment:'Tee',      price:'$64', priceNum:64, price2xl:'$68', priceNum2xl:68, model:'img/venezia-tee-white-model.webp',    flat:'img/venezia-tee-white.webp',    sizes:['S','M','L','XL','2XL'],
      colors: [
        { name:'White', model:'img/venezia-tee-white-model.webp', flat:'img/venezia-tee-white.webp' },
        { name:'Black', model:'img/venezia-tee-black-model.webp', flat:'img/venezia-tee-black.webp' }
      ] },
    crew:   { title:'Venezia', artwork:'Artwork 01', plate:'03', garment:'Crewneck', price:'$84', priceNum:84, price2xl:'$88', priceNum2xl:88, model:'img/venezia-crew-model-front.webp',   flat:'img/venezia-crewneck.webp',   sizes:['S','M','L','XL','2XL','3XL'],
      colors: [
        { name:'White', model:'img/venezia-crew-model-front.webp', flat:'img/venezia-crewneck.webp' },
        { name:'Black', model:'img/black-crew-gold-type-front.webp', flat:'img/black-crew-gold-type-front.webp' }
      ] },
    'arhus-old-town-tee': { title:'Århus, The Old Town', artwork:'Artwork 02', plate:'04', garment:'Tee', price:'$64', priceNum:64, price2xl:'$68', priceNum2xl:68, model:'img/the-old-town-model.webp', flat:'img/arhus-the-old-town-tee.webp', sizes:['S','M','L','XL','2XL'], frontColor:'Black' },
    'wind-sea-tee': { title:'Wind & Sea', artwork:'Artwork 03', plate:'05', garment:'Tee', price:'$64', priceNum:64, price2xl:'$68', priceNum2xl:68, model:'img/wind-and-sea-tee-model.webp', flat:'img/wind-and-sea-tee.webp', sizes:['S','M','L','XL','2XL'], frontColor:'Black' },
    'waves-of-life-tee': { title:'Waves of Life', artwork:'Artwork 04', plate:'06', garment:'Tee', price:'$64', priceNum:64, price2xl:'$68', priceNum2xl:68, model:'img/waves-of-life-tee-model.webp', flat:'img/waves-of-life-tee.webp', sizes:['S','M','L','XL','2XL'],
      colors: [
        { name:'White', model:'img/waves-of-life-tee-model.webp', flat:'img/waves-of-life-tee.webp' },
        { name:'Black', model:'img/waves-of-life-black-tee-model.webp', flat:'img/waves-of-life-black-tee.webp' }
      ] },
    'villa-d-este-tee': { title:'Villa d\'Este', artwork:'Artwork 05', plate:'07', garment:'Tee', price:'$64', priceNum:64, price2xl:'$68', priceNum2xl:68, model:'img/villa-d-este-model.webp', flat:'img/villa-d-este-tee.webp', sizes:['S','M','L','XL','2XL'], frontColor:'Black' },
    // Cream/Oatmeal reuse the White photos — no separate photography
    // exists for them yet (owner-confirmed 2026-08-20: ship the color
    // options now rather than wait). Swap in real photos per color
    // once shot.
    'the-wedge-tee': { title:'The Wedge', artwork:'Artwork 06', plate:'08', garment:'Tee', price:'$64', priceNum:64, price2xl:'$68', priceNum2xl:68, model:'img/the-wedge-tee-model.webp', flat:'img/the-wedge-tee.webp', sizes:['S','M','L','XL','2XL'],
      colors: [
        { name:'White', model:'img/the-wedge-tee-model.webp', flat:'img/the-wedge-tee.webp' },
        { name:'Cream', model:'img/the-wedge-tee-model.webp', flat:'img/the-wedge-tee.webp' },
        { name:'Oatmeal', model:'img/the-wedge-tee-model.webp', flat:'img/the-wedge-tee.webp' }
      ] },
    'leaning-tower-of-pisa-tee': { title:'Leaning Tower of Pisa', artwork:'Artwork 07', plate:'09', garment:'Tee', price:'$64', priceNum:64, price2xl:'$68', priceNum2xl:68, model:'img/leaning-tower-of-pisa-tee-model.webp', flat:'img/leaning-tower-of-pisa-tee.webp', sizes:['S','M','L','XL','2XL'], frontColor:'White' },
    'piazza-san-marco-tee': { title:'Piazza San Marco', artwork:'Artwork 08', plate:'10', garment:'Tee', price:'$64', priceNum:64, price2xl:'$68', priceNum2xl:68, model:'img/piazza-san-marco-tee-model.webp', flat:'img/piazza-san-marco-tee-flat.webp', sizes:['S','M','L','XL','2XL'], frontColor:'White' },
    'palatine-hill-tee': { title:'Palatine Hill', artwork:'Artwork 09', plate:'11', garment:'Tee', price:'$64', priceNum:64, price2xl:'$68', priceNum2xl:68, model:'img/palatine-hill-tee-model.webp', flat:'img/palatine-hill-tee.webp', sizes:['S','M','L','XL','2XL'],
      colors: [
        { name:'White', model:'img/palatine-hill-tee-model.webp', flat:'img/palatine-hill-tee.webp' },
        { name:'Cream', model:'img/palatine-hill-tee-model.webp', flat:'img/palatine-hill-tee.webp' },
        { name:'Oatmeal', model:'img/palatine-hill-tee-model.webp', flat:'img/palatine-hill-tee.webp' }
      ] },
    // Only White has been photographed — Cream reuses the White shots
    // until real photography exists for it, same pattern as The Wedge/
    // Palatine Hill.
    'ostia-antica-tee': { title:'Ostia Antica', artwork:'Artwork 10', plate:'12', garment:'Tee', price:'$64', priceNum:64, price2xl:'$68', priceNum2xl:68, model:'img/ostia-antica-tee-model.webp', flat:'img/ostia-antica-tee.webp', sizes:['S','M','L','XL','2XL'],
      colors: [
        { name:'White', model:'img/ostia-antica-tee-model.webp', flat:'img/ostia-antica-tee.webp' },
        { name:'Cream', model:'img/ostia-antica-tee-model.webp', flat:'img/ostia-antica-tee.webp' }
      ] },
    'waves-of-life-crew': { title:'Waves of Life', artwork:'Artwork 04', plate:'13', garment:'Crewneck', price:'$84', priceNum:84, price2xl:'$88', priceNum2xl:88, model:'img/waves-of-life-white-crew-model.webp', flat:'img/waves-of-life-white-crew.webp', sizes:['S','M','L','XL','2XL','3XL'],
      colors: [
        { name:'White', model:'img/waves-of-life-white-crew-model.webp', flat:'img/waves-of-life-white-crew.webp' },
        { name:'Black', model:'img/waves-of-life-black-crew-model.webp', flat:'img/waves-of-life-black-crew.webp' }
      ] },
    'villa-d-este-crew': { title:'Villa d\'Este', artwork:'Artwork 05', plate:'14', garment:'Crewneck', price:'$84', priceNum:84, price2xl:'$88', priceNum2xl:88, model:'img/villa-d-este-crew-model.webp', flat:'img/villa-d-este-crew.webp', sizes:['S','M','L','XL','2XL','3XL'] },
    'palatine-hill-crew': { title:'Palatine Hill', artwork:'Artwork 09', plate:'15', garment:'Crewneck', price:'$84', priceNum:84, price2xl:'$88', priceNum2xl:88, model:'img/palatine-hill-crew-bone-model.webp', flat:'img/palatine-hill-crew-bone.webp', sizes:['S','M','L','XL','2XL','3XL'],
      colors: [
        { name:'Bone', model:'img/palatine-hill-crew-bone-model.webp', flat:'img/palatine-hill-crew-bone.webp' },
        { name:'White', model:'img/palatine-hill-crew-white-model.webp', flat:'img/palatine-hill-crew-white.webp' }
      ] },
    'wind-sea-crew': { title:'Wind & Sea', artwork:'Artwork 03', plate:'16', garment:'Crewneck', price:'$84', priceNum:84, price2xl:'$88', priceNum2xl:88, model:'img/wind-and-sea-crew-model.webp', flat:'img/wind-and-sea-crew.webp', sizes:['S','M','L','XL','2XL','3XL'] },
    'arhus-old-town-crew': { title:'Århus, The Old Town', artwork:'Artwork 02', plate:'17', garment:'Crewneck', price:'$84', priceNum:84, price2xl:'$88', priceNum2xl:88, model:'img/arhus-the-old-town-crew-model.webp', flat:'img/arhus-the-old-town-crew.webp', sizes:['S','M','L','XL','2XL','3XL'] },
    'new-york-crew': { title:'New York', artwork:'Artwork 11', plate:'18', garment:'Crewneck', price:'$84', priceNum:84, price2xl:'$88', priceNum2xl:88, model:'img/new-york-crew-model.webp', flat:'img/new-york-crew.webp', sizes:['S','M','L','XL','2XL','3XL'] }
  };

  var EDITION_DESC = {
    tee: 'Series 01 — Venezia Tee. A heavyweight cotton t-shirt, one of two wearable pieces from a single artwork.',
    crew: 'Series 01 — Venezia Crewneck. A heavyweight fleece crewneck, one of two wearable pieces from a single artwork.',
    'arhus-old-town-tee': 'Series 01 — Århus, The Old Town Tee. A 1980 vintage Kodak slide from Århus, Denmark.',
    'wind-sea-tee': 'Series 01 — Wind & Sea Tee. "Valley Vista to the Ocean," painted by Tony DeAngelo in New York, 1999.',
    'waves-of-life-tee': 'Series 01 — Waves of Life Tee. "Crashing waves of life," painted by Tony DeAngelo in New York, 1990.',
    'villa-d-este-tee': 'Series 01 — Villa d\'Este Tee. A 1980 vintage Kodak slide of Tivoli, Italy.',
    'the-wedge-tee': 'Series 01 — The Wedge Tee. "By Water or By Air," painted by Tony DeAngelo in New York, 1990.',
    'leaning-tower-of-pisa-tee': 'Series 01 — Leaning Tower of Pisa Tee. A 1980 vintage Kodak slide of Pisa, Italy.',
    'piazza-san-marco-tee': 'Series 01 — Piazza San Marco Tee. A 1980 vintage Kodak slide of Venice, Italy.',
    'palatine-hill-tee': 'Series 01 — Palatine Hill Tee. A 1980 vintage Kodak slide of Rome, Italy.',
    'ostia-antica-tee': 'Series 01 — Ostia Antica Tee. A 1980 vintage Kodak slide of Ostia Antica, Italy.',
    'waves-of-life-crew': 'Series 01 — Waves of Life Crewneck. "Crashing waves of life," painted by Tony DeAngelo in New York, 1990.',
    'villa-d-este-crew': 'Series 01 — Villa d\'Este Crewneck. A 1980 vintage Kodak slide of Tivoli, Italy.',
    'palatine-hill-crew': 'Series 01 — Palatine Hill Crewneck. A 1980 vintage Kodak slide of Rome, Italy.',
    'wind-sea-crew': 'Series 01 — Wind & Sea Crewneck. "Valley Vista to the Ocean," painted by Tony DeAngelo in New York, 1999.',
    'arhus-old-town-crew': 'Series 01 — Århus, The Old Town Crewneck. A 1980 vintage Kodak slide from Århus, Denmark.',
    'new-york-crew': 'Series 01 — New York Crewneck. The Chrysler Building and Empire State Building, painted by Tony DeAngelo in New York, 2019.'
  };

  // The Source — per-artwork story. Venezia products (tee/crew) keep
  // their existing, unchanged copy. Århus gets its own confirmed
  // artwork description and garment description — never Venezia's.
  var VENEZIA_SOURCE = {
    artImg: 'img/venezia-source.webp',
    artAlt: 'Venezia — Original Artwork, Tony DeAngelo, 1979',
    captionMedium: 'Venezia · No. 01',
    captionYear: '1979',
    eyebrow: 'The Source · Artwork 01',
    titleHtml: 'Venezia <em>1979</em>',
    medium: 'Isola di San Giorgio Maggiore, Venice Italy',
    pull: 'Water Color on Textured Paper.',
    bodyHtml: '',
    signName: 'Tony DeAngelo',
    signatureImg: 'img/tony-deangelo-signature.webp',
    provArtworkValueHtml: 'No. <em>01</em>',
    provArtworkAside: 'Venezia — water color on textured paper, 1979.',
    provPrintedAside: 'Direct-to-garment print. Water-based inks.'
  };
  var SOURCE = {
    tee: VENEZIA_SOURCE, crew: VENEZIA_SOURCE,
    'arhus-old-town-tee': {
      artImg: 'img/arhus-source.webp',
      artAlt: 'Århus, The Old Town — Original Photograph',
      captionMedium: 'Århus, The Old Town · Vintage European Kodak Slide',
      captionYear: '1980',
      eyebrow: 'The Source · Artwork 02',
      titleHtml: 'Århus, <em>The Old Town</em>',
      medium: '',
      pull: 'A quiet corner of Denmark, held on film since 1980.',
      bodyHtml: '<p>A 1980 vintage Kodak slide from Århus, Denmark — a quiet, narrow passage opening onto sunlit tiled rooftops and timbered buildings in the city\'s old town.</p>' +
        '<p>Printed vertically across the back of a garment-dyed drop-shoulder tee, the photograph is paired with a relaxed silhouette and vintage-washed cotton.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>02</em>',
      provArtworkAside: 'Århus, The Old Town, 1980.',
      provPrintedAside: ''
    },
    'wind-sea-tee': {
      artImg: 'img/wind-and-sea-source.webp',
      artAlt: 'Wind & Sea — Original Artwork',
      captionMedium: 'Wind & Sea · Water Based Latex on Canvas',
      captionYear: '1999',
      eyebrow: 'The Source · Artwork 03',
      titleHtml: 'Wind &amp; <em>Sea</em>',
      medium: '',
      pull: '"Valley Vista to the Ocean."',
      bodyHtml: '<p>Wind & Sea holds a valley vista opening toward the ocean — painted by Tony DeAngelo in water-based latex on canvas, New York, 1999.</p>' +
        '<p>Printed vertically across the back of a garment-dyed drop-shoulder tee, the artwork is paired with a relaxed silhouette and vintage-washed cotton.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>03</em>',
      provArtworkAside: 'Wind & Sea, 1999.',
      provPrintedAside: ''
    },
    'waves-of-life-tee': {
      artImg: 'img/waves-of-life-source.webp',
      artAlt: 'Waves of Life — Original Artwork',
      captionMedium: 'Waves of Life · Pastel on Textured Paper',
      captionYear: '1990',
      eyebrow: 'The Source · Artwork 04',
      titleHtml: 'Waves of <em>Life</em>',
      medium: '',
      pull: '"Crashing waves of life."',
      bodyHtml: '<p>Waves of Life holds crashing waves rendered in pastel on textured paper — painted by Tony DeAngelo in New York, 1990.</p>' +
        '<p>Printed vertically across the back of a garment-dyed drop-shoulder tee, the artwork is paired with a relaxed silhouette and vintage-washed cotton.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>04</em>',
      provArtworkAside: 'Waves of Life, 1990.',
      provPrintedAside: ''
    },
    'villa-d-este-tee': {
      artImg: 'img/villa-d-este-source.webp',
      artAlt: 'Villa d\'Este — Original Photograph',
      captionMedium: 'Villa d\'Este · Vintage European Kodak Slide',
      captionYear: '1980',
      eyebrow: 'The Source · Artwork 05',
      titleHtml: 'Villa d\'<em>Este</em>',
      medium: '',
      pull: 'A thousand fountains, caught mid-fall.',
      bodyHtml: '<p>A 1980 vintage Kodak slide of the terraced fountains at Villa d\'Este, Tivoli, Italy — water caught mid-cascade down a dim stone stairway, framed by dense garden shadow.</p>' +
        '<p>Printed vertically across the back of a garment-dyed drop-shoulder tee, the photograph is paired with a relaxed silhouette and vintage-washed cotton.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>05</em>',
      provArtworkAside: 'Villa d\'Este, 1980.',
      provPrintedAside: ''
    },
    'the-wedge-tee': {
      artImg: 'img/the-wedge-tee.webp',
      artAlt: 'The Wedge — Original Artwork',
      captionMedium: 'The Wedge · Water Color on Textured Paper',
      captionYear: '1990',
      eyebrow: 'The Source · Artwork 06',
      titleHtml: 'The <em>Wedge</em>',
      medium: '',
      pull: '"By Water or By Air."',
      bodyHtml: '<p>The Wedge holds a scene titled "By Water or By Air" — painted by Tony DeAngelo in watercolor on textured paper, New York, 1990.</p>' +
        '<p>Printed vertically across the back of a garment-dyed drop-shoulder tee, the artwork is paired with a relaxed silhouette and vintage-washed cotton.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>06</em>',
      provArtworkAside: 'The Wedge, 1990.',
      provPrintedAside: ''
    },
    'leaning-tower-of-pisa-tee': {
      artImg: 'img/pisa-source.webp',
      artAlt: 'Leaning Tower of Pisa — Original Photograph',
      captionMedium: 'Leaning Tower of Pisa · Vintage European Kodak Slide',
      captionYear: '1980',
      eyebrow: 'The Source · Artwork 07',
      titleHtml: 'Leaning Tower <em>of Pisa</em>',
      medium: '',
      pull: 'Eight centuries off balance, and still standing.',
      bodyHtml: '<p>A 1980 vintage Kodak slide of Pisa\'s cathedral square — the bell tower caught leaning against a low, overcast sky, its marble tiers stacked slightly off true, a flaw the centuries turned into its signature.</p>' +
        '<p>Printed vertically across the back of a garment-dyed drop-shoulder tee, the photograph is paired with a relaxed silhouette and vintage-washed cotton.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>07</em>',
      provArtworkAside: 'Leaning Tower of Pisa, 1980.',
      provPrintedAside: ''
    },
    'piazza-san-marco-tee': {
      artImg: 'img/piazza-san-marco-tee-flat.webp',
      artAlt: 'Piazza San Marco — Original Photograph',
      captionMedium: 'Piazza San Marco · Vintage European Kodak Slide',
      captionYear: '1980',
      eyebrow: 'The Source · Artwork 08',
      titleHtml: 'Piazza <em>San Marco</em>',
      medium: '',
      pull: 'The square empties, and the basilica remains.',
      bodyHtml: '<p>A 1980 vintage Kodak slide of Venice\'s central square — the domes and arches of St. Mark\'s Basilica rising above a scattering of figures crossing the stone at midday.</p>' +
        '<p>Printed vertically across the back of a garment-dyed drop-shoulder tee, the photograph is paired with a relaxed silhouette and vintage-washed cotton.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>08</em>',
      provArtworkAside: 'Piazza San Marco, 1980.',
      provPrintedAside: ''
    },
    'palatine-hill-tee': {
      artImg: 'img/palatine-hill-tee.webp',
      artAlt: 'Palatine Hill — Original Photograph',
      captionMedium: 'Palatine Hill · Vintage European Kodak Slide',
      captionYear: '1980',
      eyebrow: 'The Source · Artwork 09',
      titleHtml: 'Palatine <em>Hill</em>',
      medium: '',
      pull: 'Rome\'s oldest quarter, still standing at the edge of itself.',
      bodyHtml: '<p>A 1980 vintage Kodak slide of Palatine Hill, Rome — a brick retaining wall curves through the ruins, columns and overgrowth framing the path where Rome is said to have begun.</p>' +
        '<p>Printed vertically across the back of a garment-dyed drop-shoulder tee, the photograph is paired with a relaxed silhouette and vintage-washed cotton.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>09</em>',
      provArtworkAside: 'Palatine Hill, 1980.',
      provPrintedAside: ''
    },
    'ostia-antica-tee': {
      artImg: 'img/ostia-antica-tee.webp',
      artAlt: 'Ostia Antica — Original Photograph',
      captionMedium: 'Ostia Antica · Vintage European Kodak Slide',
      captionYear: '1980',
      eyebrow: 'The Source · Artwork 10',
      titleHtml: 'Ostia <em>Antica</em>',
      medium: '',
      pull: 'Rome\'s ancient port, quiet now beneath the pines.',
      bodyHtml: '<p>A 1980 vintage Kodak slide of Ostia Antica, the excavated Roman port city — sun-bleached brick and columns rising from the grass where Rome once met the sea.</p>' +
        '<p>Printed vertically across the back of a garment-dyed drop-shoulder tee, the photograph is paired with a relaxed silhouette and vintage-washed cotton.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>10</em>',
      provArtworkAside: 'Ostia Antica, 1980.',
      provPrintedAside: ''
    },
    'waves-of-life-crew': {
      artImg: 'img/waves-of-life-source.webp',
      artAlt: 'Waves of Life — Original Artwork',
      captionMedium: 'Waves of Life · Pastel on Textured Paper',
      captionYear: '1990',
      eyebrow: 'The Source · Artwork 04',
      titleHtml: 'Waves of <em>Life</em>',
      medium: '',
      pull: '"Crashing waves of life."',
      bodyHtml: '<p>Waves of Life holds crashing waves rendered in pastel on textured paper — painted by Tony DeAngelo in New York, 1990.</p>' +
        '<p>Printed across the back of a heavyweight fleece crewneck, the artwork is paired with a relaxed, generous fit and ribbed cuffs and waistband.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>04</em>',
      provArtworkAside: 'Waves of Life, 1990.',
      provPrintedAside: ''
    },
    'villa-d-este-crew': {
      artImg: 'img/villa-d-este-source.webp',
      artAlt: 'Villa d\'Este — Original Photograph',
      captionMedium: 'Villa d\'Este · Vintage European Kodak Slide',
      captionYear: '1980',
      eyebrow: 'The Source · Artwork 05',
      titleHtml: 'Villa d\'<em>Este</em>',
      medium: '',
      pull: 'A thousand fountains, caught mid-fall.',
      bodyHtml: '<p>A 1980 vintage Kodak slide of the terraced fountains at Villa d\'Este, Tivoli, Italy — water caught mid-cascade down a dim stone stairway, framed by dense garden shadow.</p>' +
        '<p>Printed across the back of a heavyweight fleece crewneck, the photograph is paired with a relaxed, generous fit and ribbed cuffs and waistband.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>05</em>',
      provArtworkAside: 'Villa d\'Este, 1980.',
      provPrintedAside: ''
    },
    'palatine-hill-crew': {
      artImg: 'img/palatine-hill-tee.webp',
      artAlt: 'Palatine Hill — Original Photograph',
      captionMedium: 'Palatine Hill · Vintage European Kodak Slide',
      captionYear: '1980',
      eyebrow: 'The Source · Artwork 09',
      titleHtml: 'Palatine <em>Hill</em>',
      medium: '',
      pull: 'Rome\'s oldest quarter, still standing at the edge of itself.',
      bodyHtml: '<p>A 1980 vintage Kodak slide of Palatine Hill, Rome — a brick retaining wall curves through the ruins, columns and overgrowth framing the path where Rome is said to have begun.</p>' +
        '<p>Printed across the back of a heavyweight fleece crewneck, the photograph is paired with a relaxed, generous fit and ribbed cuffs and waistband.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>09</em>',
      provArtworkAside: 'Palatine Hill, 1980.',
      provPrintedAside: ''
    },
    'wind-sea-crew': {
      artImg: 'img/wind-and-sea-source.webp',
      artAlt: 'Wind & Sea — Original Artwork',
      captionMedium: 'Wind & Sea · Water Based Latex on Canvas',
      captionYear: '1999',
      eyebrow: 'The Source · Artwork 03',
      titleHtml: 'Wind &amp; <em>Sea</em>',
      medium: '',
      pull: '"Valley Vista to the Ocean."',
      bodyHtml: '<p>Wind & Sea holds a valley vista opening toward the ocean — painted by Tony DeAngelo in water-based latex on canvas, New York, 1999.</p>' +
        '<p>Printed across the back of a heavyweight fleece crewneck, the artwork is paired with a relaxed, generous fit and ribbed cuffs and waistband.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>03</em>',
      provArtworkAside: 'Wind & Sea, 1999.',
      provPrintedAside: ''
    },
    'arhus-old-town-crew': {
      artImg: 'img/arhus-source.webp',
      artAlt: 'Århus, The Old Town — Original Photograph',
      captionMedium: 'Århus, The Old Town · Vintage European Kodak Slide',
      captionYear: '1980',
      eyebrow: 'The Source · Artwork 02',
      titleHtml: 'Århus, <em>The Old Town</em>',
      medium: '',
      pull: 'A quiet corner of Denmark, held on film since 1980.',
      bodyHtml: '<p>A 1980 vintage Kodak slide from Århus, Denmark — a quiet, narrow passage opening onto sunlit tiled rooftops and timbered buildings in the city\'s old town.</p>' +
        '<p>Printed across the back of a heavyweight fleece crewneck, the photograph is paired with a relaxed, generous fit and ribbed cuffs and waistband.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>02</em>',
      provArtworkAside: 'Århus, The Old Town, 1980.',
      provPrintedAside: ''
    },
    'new-york-crew': {
      artImg: 'img/new-york-crew.webp',
      artAlt: 'New York — Original Artwork',
      captionMedium: 'New York · Acrylic on Canvas',
      captionYear: '2019',
      eyebrow: 'The Source · Artwork 11',
      titleHtml: 'New <em>York</em>',
      medium: '',
      pull: 'Chrysler Building and Empire State Building, side by side.',
      bodyHtml: '<p>New York holds the Chrysler Building and Empire State Building side by side — painted by Tony DeAngelo in acrylic on canvas, New York, 2019.</p>' +
        '<p>Printed across the back of a heavyweight fleece crewneck, the artwork is paired with a relaxed, generous fit and ribbed cuffs and waistband.</p>',
      signName: 'Tony DeAngelo',
      signatureImg: '',
      provArtworkValueHtml: 'No. <em>11</em>',
      provArtworkAside: 'New York, 2019.',
      provPrintedAside: ''
    }
  };

  var SIZE_CHART_ID = { tee:'sgTee', crew:'sgCrew', 'arhus-old-town-tee':'sgTee', 'wind-sea-tee':'sgTee', 'waves-of-life-tee':'sgTee', 'villa-d-este-tee':'sgTee', 'the-wedge-tee':'sgTee', 'leaning-tower-of-pisa-tee':'sgTee', 'piazza-san-marco-tee':'sgTee', 'palatine-hill-tee':'sgTee', 'ostia-antica-tee':'sgTee', 'waves-of-life-crew':'sgCrew', 'villa-d-este-crew':'sgCrew', 'palatine-hill-crew':'sgCrew', 'wind-sea-crew':'sgCrew', 'arhus-old-town-crew':'sgCrew', 'new-york-crew':'sgCrew' };

  // Per-product details
  var DETAILS = {
    // Material/fit/print confirmed against Printify's own blueprint specs
    // (GET /v1/catalog/blueprints/1723.json for tee, /6992.json for crew)
    // and print_providers.json for the blueprint, which lists "dtg" as the
    // only decoration method for every provider on this account -- there
    // is no screen-printing option at all, so "hand-pulled screen print"
    // was never accurate.
    tee:    { material:'100% USA cotton, medium-weight (7.5oz/yd²). Garment-dyed for a soft, vintage, worn-in look.', fit:'Oversized drop-shoulder silhouette. Double-needle stitched collar, forward-thrusted shoulder seam.', print:'Direct-to-garment print, water-based inks. Back placement.' },
    crew:   { material:'70% ring-spun cotton, 30% polyester, heavyweight fleece (10oz/yd²), 100% cotton face.', fit:'Generous, relaxed crewneck fit. Double-needle stitched seams, twill neck tape, 1x1 ribbed cuff and waistband.', print:'Direct-to-garment print, water-based inks. Back placement.' },
    'arhus-old-town-tee': { material:'Garment-dyed, vintage-washed cotton.', fit:'Relaxed drop-shoulder silhouette.', print:'Printed vertically across the back.' },
    'wind-sea-tee': { material:'Garment-dyed, vintage-washed cotton.', fit:'Relaxed drop-shoulder silhouette.', print:'Printed vertically across the back.' },
    'waves-of-life-tee': { material:'Garment-dyed, vintage-washed cotton.', fit:'Relaxed drop-shoulder silhouette.', print:'Printed vertically across the back.' },
    'villa-d-este-tee': { material:'Garment-dyed, vintage-washed cotton.', fit:'Relaxed drop-shoulder silhouette.', print:'Printed vertically across the back.' },
    'the-wedge-tee': { material:'Garment-dyed, vintage-washed cotton.', fit:'Relaxed drop-shoulder silhouette.', print:'Printed vertically across the back.' },
    'leaning-tower-of-pisa-tee': { material:'Garment-dyed, vintage-washed cotton.', fit:'Relaxed drop-shoulder silhouette.', print:'Printed vertically across the back.' },
    'piazza-san-marco-tee': { material:'Garment-dyed, vintage-washed cotton.', fit:'Relaxed drop-shoulder silhouette.', print:'Printed vertically across the back.' },
    'palatine-hill-tee': { material:'Garment-dyed, vintage-washed cotton.', fit:'Relaxed drop-shoulder silhouette.', print:'Printed vertically across the back.' },
    'ostia-antica-tee': { material:'Garment-dyed, vintage-washed cotton.', fit:'Relaxed drop-shoulder silhouette.', print:'Printed vertically across the back.' },
    'waves-of-life-crew': { material:'70% ring-spun cotton, 30% polyester, heavyweight fleece (10oz/yd²), 100% cotton face.', fit:'Generous, relaxed crewneck fit. Double-needle stitched seams, twill neck tape, 1x1 ribbed cuff and waistband.', print:'Direct-to-garment print, water-based inks. Back placement.' },
    'villa-d-este-crew': { material:'70% ring-spun cotton, 30% polyester, heavyweight fleece (10oz/yd²), 100% cotton face.', fit:'Generous, relaxed crewneck fit. Double-needle stitched seams, twill neck tape, 1x1 ribbed cuff and waistband.', print:'Direct-to-garment print, water-based inks. Back placement.' },
    'palatine-hill-crew': { material:'70% ring-spun cotton, 30% polyester, heavyweight fleece (10oz/yd²), 100% cotton face.', fit:'Generous, relaxed crewneck fit. Double-needle stitched seams, twill neck tape, 1x1 ribbed cuff and waistband.', print:'Direct-to-garment print, water-based inks. Back placement.' },
    'wind-sea-crew': { material:'70% ring-spun cotton, 30% polyester, heavyweight fleece (10oz/yd²), 100% cotton face.', fit:'Generous, relaxed crewneck fit. Double-needle stitched seams, twill neck tape, 1x1 ribbed cuff and waistband.', print:'Direct-to-garment print, water-based inks. Back placement.' },
    'arhus-old-town-crew': { material:'70% ring-spun cotton, 30% polyester, heavyweight fleece (10oz/yd²), 100% cotton face.', fit:'Generous, relaxed crewneck fit. Double-needle stitched seams, twill neck tape, 1x1 ribbed cuff and waistband.', print:'Direct-to-garment print, water-based inks. Back placement.' },
    'new-york-crew': { material:'70% ring-spun cotton, 30% polyester, heavyweight fleece (10oz/yd²), 100% cotton face.', fit:'Generous, relaxed crewneck fit. Double-needle stitched seams, twill neck tape, 1x1 ribbed cuff and waistband.', print:'Direct-to-garment print, water-based inks. Back placement.' }
  };

  // ── Collection grid ───────────────────────────────────────────
  const PLATES = [
    { n:"01", title:"Venezia", garment:"Tee", price:"$64", slug:"tee", type:"tee", colors:["White","Black"],
      model:"img/venezia-tee-white-model.webp", flat:"img/venezia-tee-white.webp",
      desc:"Oversized cotton tee. Sourced from Venezia — watercolor, 1979. Direct-to-garment print, water-based inks." },
    // Venezia Hoodie removed from the site entirely 2026-09-08 (owner:
    // "we only have tees and crews right now") — see functions/_lib/
    // catalog.js. Do not re-add without the owner confirming a real,
    // live Printify product for it first.
    { n:"03", title:"Venezia", garment:"Crewneck", price:"$84", slug:"crew", type:"sweatshirt", colors:["White","Black"],
      model:"img/venezia-crew-model-front.webp", flat:"img/venezia-crewneck.webp",
      desc:"Heavyweight fleece crewneck. Dropped shoulder, ribbed cuffs and waistband, boxy crew neck." },
    { n:"03", title:"Venezia", garment:"Crewneck", price:"$84", slug:"crew", type:"sweatshirt", colors:["Black","White"],
      model:"img/venezia-black-crew-model.webp", flat:"img/venezia-black-crew.webp",
      desc:"Heavyweight fleece crewneck. Dropped shoulder, ribbed cuffs and waistband, boxy crew neck." },
    { n:"04", title:"Århus, The Old Town", garment:"Tee", price:"$64", slug:"arhus-old-town-tee", type:"tee", colors:["Black"],
      model:"img/the-old-town-model.webp", flat:"img/arhus-the-old-town-tee.webp",
      desc:"A 1980 vintage Kodak slide from Århus, Denmark. Garment-dyed drop-shoulder tee, vintage-washed cotton, printed vertically across the back." },
    { n:"05", title:"Wind & Sea", garment:"Tee", price:"$64", slug:"wind-sea-tee", type:"tee", colors:["Black"],
      model:"img/wind-and-sea-tee-model.webp", flat:"img/wind-and-sea-tee.webp",
      desc:"\"Valley Vista to the Ocean\" — painted by Tony DeAngelo in New York, 1999. Garment-dyed drop-shoulder tee, vintage-washed cotton, printed vertically across the back." },
    { n:"06", title:"Waves of Life", garment:"Tee", price:"$64", slug:"waves-of-life-tee", type:"tee", colors:["White","Black"],
      model:"img/waves-of-life-tee-model.webp", flat:"img/waves-of-life-tee.webp",
      desc:"\"Crashing waves of life\" — painted by Tony DeAngelo in New York, 1990. Garment-dyed drop-shoulder tee, vintage-washed cotton, printed vertically across the back." },
    { n:"07", title:"Villa d'Este", garment:"Tee", price:"$64", slug:"villa-d-este-tee", type:"tee", colors:["Black"],
      model:"img/villa-d-este-model.webp", flat:"img/villa-d-este-tee.webp",
      desc:"A 1980 vintage Kodak slide of the terraced fountains at Tivoli, Italy, caught mid-cascade down a dim stone stairway. Garment-dyed drop-shoulder tee, vintage-washed cotton, printed vertically across the back." },
    { n:"17", title:"Århus, The Old Town", garment:"Crewneck", price:"$84", slug:"arhus-old-town-crew", type:"sweatshirt", colors:["Black"],
      model:"img/arhus-the-old-town-crew-model.webp", flat:"img/arhus-the-old-town-crew.webp",
      desc:"A 1980 vintage Kodak slide from Århus, Denmark. Heavyweight fleece crewneck, dropped shoulder, ribbed cuffs and waistband, printed across the back." },
    { n:"16", title:"Wind & Sea", garment:"Crewneck", price:"$84", slug:"wind-sea-crew", type:"sweatshirt", colors:["Black"],
      model:"img/black-crew-gold-type-front.webp", flat:"img/wind-and-sea-crew.webp",
      desc:"\"Valley Vista to the Ocean\" — painted by Tony DeAngelo in New York, 1999. Heavyweight fleece crewneck, dropped shoulder, ribbed cuffs and waistband, printed across the back." },
    { n:"13", title:"Waves of Life", garment:"Crewneck", price:"$84", slug:"waves-of-life-crew", type:"sweatshirt", colors:["White","Black"],
      model:"img/waves-of-life-white-crew-model.webp", flat:"img/waves-of-life-white-crew.webp",
      desc:"\"Crashing waves of life\" — painted by Tony DeAngelo in New York, 1990. Heavyweight fleece crewneck, dropped shoulder, ribbed cuffs and waistband, printed across the back." },
    { n:"14", title:"Villa d'Este", garment:"Crewneck", price:"$84", slug:"villa-d-este-crew", type:"sweatshirt", colors:["Black"],
      model:"img/villa-d-este-crew-model.webp", flat:"img/villa-d-este-crew.webp",
      desc:"A 1980 vintage Kodak slide of the terraced fountains at Tivoli, Italy, caught mid-cascade down a dim stone stairway. Heavyweight fleece crewneck, dropped shoulder, ribbed cuffs and waistband, printed across the back." },
    { n:"15", title:"Palatine Hill", garment:"Crewneck", price:"$84", slug:"palatine-hill-crew", type:"sweatshirt", colors:["Bone","White"],
      model:"img/palatine-hill-crew-bone-model.webp", flat:"img/palatine-hill-crew-bone.webp",
      desc:"A 1980 vintage Kodak slide of Palatine Hill, Rome, where a brick retaining wall curves through the ruins. Heavyweight fleece crewneck, dropped shoulder, ribbed cuffs and waistband, printed across the back." },
    { n:"18", title:"New York", garment:"Crewneck", price:"$84", slug:"new-york-crew", type:"sweatshirt", colors:["White"],
      model:"img/new-york-crew-model.webp", flat:"img/new-york-crew.webp",
      desc:"The Chrysler Building and Empire State Building, painted by Tony DeAngelo in New York, 2019. Heavyweight fleece crewneck, dropped shoulder, ribbed cuffs and waistband, printed across the back." },
    { n:"08", title:"The Wedge", garment:"Tee", price:"$64", slug:"the-wedge-tee", type:"tee", colors:["White","Cream","Oatmeal"],
      model:"img/the-wedge-tee-model.webp", flat:"img/the-wedge-tee.webp",
      desc:"\"By Water or By Air\" — painted by Tony DeAngelo in New York, 1990. Garment-dyed drop-shoulder tee, vintage-washed cotton, printed vertically across the back." },
    { n:"09", title:"Leaning Tower of Pisa", garment:"Tee", price:"$64", slug:"leaning-tower-of-pisa-tee", type:"tee", colors:["White"],
      model:"img/leaning-tower-of-pisa-tee-model.webp", flat:"img/leaning-tower-of-pisa-tee.webp",
      desc:"A 1980 vintage Kodak slide of Pisa's bell tower, leaning against a low, overcast sky. Garment-dyed drop-shoulder tee, vintage-washed cotton, printed vertically across the back." },
    { n:"10", title:"Piazza San Marco", garment:"Tee", price:"$64", slug:"piazza-san-marco-tee", type:"tee", colors:["White"],
      model:"img/piazza-san-marco-tee-model.webp", flat:"img/piazza-san-marco-tee-flat.webp",
      desc:"A 1980 vintage Kodak slide of Venice's central square, St. Mark's Basilica rising above the stone. Garment-dyed drop-shoulder tee, vintage-washed cotton, printed vertically across the back." },
    { n:"11", title:"Palatine Hill", garment:"Tee", price:"$64", slug:"palatine-hill-tee", type:"tee", colors:["White","Cream","Oatmeal"],
      model:"img/palatine-hill-tee-model.webp", flat:"img/palatine-hill-tee.webp",
      desc:"A 1980 vintage Kodak slide of Palatine Hill, Rome, where a brick retaining wall curves through the ruins. Garment-dyed drop-shoulder tee, vintage-washed cotton, printed vertically across the back." },
    { n:"12", title:"Ostia Antica", garment:"Tee", price:"$64", slug:"ostia-antica-tee", type:"tee", colors:["White","Cream"],
      model:"img/ostia-antica-tee-model.webp", flat:"img/ostia-antica-tee.webp",
      desc:"A 1980 vintage Kodak slide of Ostia Antica, Rome's ancient port — sun-bleached brick and columns rising from the grass. Garment-dyed drop-shoulder tee, vintage-washed cotton, printed vertically across the back." },
  ];

  // Mockups exist; artwork, pricing, and full details are still being
  // finalized. Shown separately from Series 01.
  const COLLECTION_PREVIEWS = [
    { title:"New York Chrysler",      slug:"new-york-chrysler",   img:"img/new-york-chrysler-hoodie.webp" },
    { title:"Verona — Oat",           slug:"verona-oat",          img:"img/verona-oat.webp" },
    { title:"Verona — Black",         slug:"verona-black",        img:"img/verona-black.webp" },
  ];


  function previewPlateHTML(p) {
    return `<article class="plate plate--single" data-type="tee" data-series="03" data-searchable="${p.title.toLowerCase()}">
      <a class="plate-link" href="product?p=${p.slug}" aria-label="View ${p.title}">
        <div class="plate-image-wrap">
          <div class="plate-image plate-image--model"><img src="${p.img}" alt="${p.title}" loading="lazy" decoding="async"></div>
        </div>
      </a>
      <div class="plate-caption">
        <div class="plate-line">
          <span class="plate-title">${p.title}</span>
        </div>
        <p class="plate-soon">Coming Soon</p>
      </div>
    </article>`;
  }

  // i = position in the grid; the first row loads eagerly, the rest lazily.
  function plateHTML(p, i) {
    const title = p.title + (p.garment ? ' — ' + p.garment : '');
    const lazy = i >= 4 ? ' loading="lazy" decoding="async"' : '';
    const imgModel = p.model ? `<img src="${p.model}" alt="${title}"${lazy}>` : `<span class="ph-label">MODEL // ${p.n}</span>`;
    const imgFlat  = p.flat  ? `<img src="${p.flat}"  alt="${title} flat" loading="lazy" decoding="async">` : `<span class="ph-label">FLAT // ${p.n}</span>`;
    const imageWrap = `<div class="plate-image-wrap">
        <div class="plate-image plate-image--model">${imgModel}</div>
        <div class="plate-image plate-image--flat">${imgFlat}</div>
      </div>`;
    return `<article class="plate${p.soon ? ' is-soon' : ''}${p.unavailable ? ' is-unavailable' : ''}" data-type="${p.type || ''}" data-series="${p.soon ? '02' : '01'}" data-searchable="${(p.title + ' ' + (p.garment || '') + ' ' + (p.colors || []).join(' ')).toLowerCase()}">
      ${p.soon
        ? imageWrap
        : `<a class="plate-link" href="product?p=${p.slug}" aria-label="View ${title}">${imageWrap}</a>`}
      <div class="plate-caption">
        <div class="plate-line">
          <span class="plate-num">${p.n}</span>
          <span class="plate-sep">//</span>
          <span class="plate-title">${title}</span>
        </div>
        ${p.soon ? '' : `<p class="plate-price">${p.price}</p>`}
        ${p.soon ? '<p class="plate-soon">Series 02 Candidate — Not for Sale</p>' : ''}
        ${p.unavailable ? '<p class="plate-soon">Currently Unavailable</p>' : ''}
        <p class="plate-desc">${p.desc}</p>
      </div>
    </article>`;
  }

  // Full collection grid markup — rendered by functions/collection.js on
  // the server and again by collection.html in the browser.
  function collectionGridHTML() {
    return PLATES.filter(function(p) { return !p.soon; }).map(plateHTML).join('') +
      `<div class="grid-divider" id="gridDividerDev">
      <span>In Development</span>
      <span class="grid-divider-sub">New pieces with mockups ready. Artwork, pricing, and full details are still being finalized.</span>
    </div>` +
      COLLECTION_PREVIEWS.map(previewPlateHTML).join('');
  }

  // Page <title>. Garment names people search for ("graphic tee",
  // "crewneck sweatshirt"), kept under 60 characters.
  function pageTitle(prod) {
    var garment = prod.garment === 'Tee' ? 'Graphic Tee' : prod.garment + ' Sweatshirt';
    var t = prod.title + ' ' + garment + ' | The DeAngelo Series';
    return t.length <= 60 ? t : prod.title + ' ' + prod.garment + ' | The DeAngelo Series';
  }

  // "Also on the wall" — a curated 4 from every other piece: one per
  // distinct artwork first, then the rest, in plate order.
  function alsoGridHTML(key) {
    var also = Object.keys(PRODS)
      .filter(function(k) { return k !== key && !PRODS[k].unavailable; })
      .map(function(k) { var e = PRODS[k]; return {
        title: e.title, plate: e.plate, garment: e.garment, price: e.price,
        slug: k, model: e.model, flat: e.flat
      }; })
      .sort(function(a, b) { return a.plate.localeCompare(b.plate); });
    var seenTitles = {};
    var distinct = also.filter(function(a) {
      if (seenTitles[a.title]) return false;
      seenTitles[a.title] = true;
      return true;
    });
    var rest = also.filter(function(a) { return distinct.indexOf(a) === -1; });
    return distinct.concat(rest).slice(0, 4).map(function(a) {
      return '<article class="plate">' +
        '<a class="plate-link" href="product?p=' + a.slug + '">' +
          '<div class="plate-image-wrap">' +
            '<div class="plate-image plate-image--model"><img src="' + a.model + '" alt="' + a.title + ' ' + a.garment + '" loading="lazy" decoding="async"></div>' +
            '<div class="plate-image plate-image--flat"><img src="' + a.flat + '" alt="' + a.title + ' ' + a.garment + ' — flat" loading="lazy" decoding="async"></div>' +
          '</div>' +
        '</a>' +
        '<div>' +
          '<div class="plate-line"><span>' + a.plate + '</span><span class="plate-sep">//</span><span>' + a.title + ' — ' + a.garment + '</span></div>' +
          '<p class="plate-price">' + a.price + '</p>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  g.DEANGELO_DATA = {
    PREVIEWS: PREVIEWS, FRONT_IMAGE_BY_COLOR: FRONT_IMAGE_BY_COLOR,
    CREW_BACK_IMAGE_BY_COLOR: CREW_BACK_IMAGE_BY_COLOR, CREW_FRONT_IMAGE: CREW_FRONT_IMAGE,
    thirdImageFor: thirdImageFor, PRODS: PRODS, EDITION_DESC: EDITION_DESC,
    VENEZIA_SOURCE: VENEZIA_SOURCE, SOURCE: SOURCE, SIZE_CHART_ID: SIZE_CHART_ID, DETAILS: DETAILS,
    PLATES: PLATES, COLLECTION_PREVIEWS: COLLECTION_PREVIEWS,
    plateHTML: plateHTML, previewPlateHTML: previewPlateHTML,
    pageTitle: pageTitle, alsoGridHTML: alsoGridHTML, collectionGridHTML: collectionGridHTML
  };
})(globalThis);
