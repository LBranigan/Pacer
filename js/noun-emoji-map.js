// noun-emoji-map.js — Maps common noun lemmas to Unicode emoji
// Used by the Reading Illustrator to visualize nouns from the passage

const NOUN_EMOJI = {
  // Animals
  dog: '\uD83D\uDC36', cat: '\uD83D\uDC31', bird: '\uD83D\uDC26', fish: '\uD83D\uDC1F',
  horse: '\uD83D\uDC34', cow: '\uD83D\uDC04', pig: '\uD83D\uDC37', sheep: '\uD83D\uDC11',
  chicken: '\uD83D\uDC14', duck: '\uD83E\uDD86', rabbit: '\uD83D\uDC30', mouse: '\uD83D\uDC2D',
  bear: '\uD83D\uDC3B', fox: '\uD83E\uDD8A', deer: '\uD83E\uDD8C', wolf: '\uD83D\uDC3A',
  lion: '\uD83E\uDD81', tiger: '\uD83D\uDC2F', elephant: '\uD83D\uDC18', monkey: '\uD83D\uDC12',
  frog: '\uD83D\uDC38', snake: '\uD83D\uDC0D', turtle: '\uD83D\uDC22', whale: '\uD83D\uDC33',
  dolphin: '\uD83D\uDC2C', butterfly: '\uD83E\uDD8B', bee: '\uD83D\uDC1D', ant: '\uD83D\uDC1C',
  spider: '\uD83D\uDD77\uFE0F', owl: '\uD83E\uDD89', eagle: '\uD83E\uDD85', penguin: '\uD83D\uDC27',
  bat: '\uD83E\uDD87', gorilla: '\uD83E\uDD8D', zebra: '\uD83E\uDD93', giraffe: '\uD83E\uDD92',
  dragon: '\uD83D\uDC09', dinosaur: '\uD83E\uDD95', bug: '\uD83D\uDC1B', worm: '\uD83E\uDEB1',
  snail: '\uD83D\uDC0C', crab: '\uD83E\uDD80', octopus: '\uD83D\uDC19', shark: '\uD83E\uDD88',
  puppy: '\uD83D\uDC36', kitten: '\uD83D\uDC31', pony: '\uD83D\uDC34', lamb: '\uD83D\uDC11',
  animal: '\uD83D\uDC3E', pet: '\uD83D\uDC3E',

  // Nature
  tree: '\uD83C\uDF33', flower: '\uD83C\uDF3B', leaf: '\uD83C\uDF43', grass: '\uD83C\uDF3F',
  forest: '\uD83C\uDF32', mountain: '\u26F0\uFE0F', river: '\uD83C\uDF0A', lake: '\uD83C\uDFDE\uFE0F',
  ocean: '\uD83C\uDF0A', sea: '\uD83C\uDF0A', beach: '\uD83C\uDFD6\uFE0F', island: '\uD83C\uDFDD\uFE0F',
  rock: '\uD83E\uDEA8', stone: '\uD83E\uDEA8', garden: '\uD83C\uDF3A', plant: '\uD83C\uDF31',
  seed: '\uD83C\uDF31', rose: '\uD83C\uDF39', mushroom: '\uD83C\uDF44', field: '\uD83C\uDF3E',
  hill: '\u26F0\uFE0F', pond: '\uD83C\uDFDE\uFE0F', desert: '\uD83C\uDFDC\uFE0F', cave: '\uD83D\uDDFB',
  world: '\uD83C\uDF0D', earth: '\uD83C\uDF0D', land: '\uD83C\uDFDE\uFE0F',

  // Weather & Sky
  sun: '\u2600\uFE0F', moon: '\uD83C\uDF19', star: '\u2B50', cloud: '\u2601\uFE0F',
  rain: '\uD83C\uDF27\uFE0F', snow: '\u2744\uFE0F', wind: '\uD83C\uDF2C\uFE0F', storm: '\u26C8\uFE0F',
  rainbow: '\uD83C\uDF08', lightning: '\u26A1', sky: '\uD83C\uDF24\uFE0F', thunder: '\u26A1',
  ice: '\uD83E\uDDCA', fire: '\uD83D\uDD25', flame: '\uD83D\uDD25',

  // People & Body
  boy: '\uD83D\uDC66', girl: '\uD83D\uDC67', man: '\uD83D\uDC68', woman: '\uD83D\uDC69',
  baby: '\uD83D\uDC76', child: '\uD83E\uDDD2', kid: '\uD83E\uDDD2', person: '\uD83E\uDDD1',
  king: '\uD83E\uDD34', queen: '\uD83D\uDC51', prince: '\uD83E\uDD34', princess: '\uD83D\uDC78',
  friend: '\uD83E\uDDD1\u200D\uD83E\uDD1D\u200D\uD83E\uDDD1', family: '\uD83D\uDC6A',
  mother: '\uD83D\uDC69', father: '\uD83D\uDC68', sister: '\uD83D\uDC67', brother: '\uD83D\uDC66',
  teacher: '\uD83E\uDDD1\u200D\uD83C\uDFEB', student: '\uD83E\uDDD1\u200D\uD83C\uDF93',
  doctor: '\uD83E\uDDD1\u200D\u2695\uFE0F', farmer: '\uD83E\uDDD1\u200D\uD83C\uDF3E',
  hand: '\u270B', eye: '\uD83D\uDC41\uFE0F', face: '\uD83D\uDE00', heart: '\u2764\uFE0F',
  head: '\uD83D\uDDE3\uFE0F', foot: '\uD83E\uDDB6', leg: '\uD83E\uDDB5',
  people: '\uD83D\uDC65', crowd: '\uD83D\uDC65', team: '\uD83D\uDC65',
  giant: '\uD83E\uDDD4', hero: '\uD83E\uDDB8',

  // Buildings & Places
  house: '\uD83C\uDFE0', home: '\uD83C\uDFE0', school: '\uD83C\uDFEB', church: '\u26EA',
  castle: '\uD83C\uDFF0', store: '\uD83C\uDFEA', shop: '\uD83C\uDFEA', hospital: '\uD83C\uDFE5',
  library: '\uD83C\uDFDB\uFE0F', city: '\uD83C\uDFD9\uFE0F', town: '\uD83C\uDFD8\uFE0F',
  building: '\uD83C\uDFE2', bridge: '\uD83C\uDF09', tower: '\uD83D\uDDFC', farm: '\uD83C\uDFE1',
  door: '\uD83D\uDEAA', window: '\uD83E\uDE9F', room: '\uD83D\uDECF\uFE0F', wall: '\uD83E\uDDF1',
  roof: '\uD83C\uDFE0', floor: '\uD83C\uDFE0', road: '\uD83D\uDEE3\uFE0F', path: '\uD83D\uDEE4\uFE0F',
  street: '\uD83D\uDEE3\uFE0F', park: '\uD83C\uDFDE\uFE0F', village: '\uD83C\uDFD8\uFE0F',

  // Food & Drink
  apple: '\uD83C\uDF4E', banana: '\uD83C\uDF4C', orange: '\uD83C\uDF4A', bread: '\uD83C\uDF5E',
  cake: '\uD83C\uDF82', cookie: '\uD83C\uDF6A', pie: '\uD83E\uDD67', egg: '\uD83E\uDD5A',
  milk: '\uD83E\uDD5B', water: '\uD83D\uDCA7', juice: '\uD83E\uDDC3', food: '\uD83C\uDF7D\uFE0F',
  meat: '\uD83E\uDD69', cheese: '\uD83E\uDDC0', pizza: '\uD83C\uDF55', soup: '\uD83C\uDF72',
  candy: '\uD83C\uDF6C', chocolate: '\uD83C\uDF6B', corn: '\uD83C\uDF3D', rice: '\uD83C\uDF5A',
  berry: '\uD83C\uDF53', fruit: '\uD83C\uDF4E', grape: '\uD83C\uDF47', peach: '\uD83C\uDF51',
  nut: '\uD83E\uDD5C', carrot: '\uD83E\uDD55', potato: '\uD83E\uDD54', tomato: '\uD83C\uDF45',
  meal: '\uD83C\uDF7D\uFE0F', dinner: '\uD83C\uDF7D\uFE0F', lunch: '\uD83C\uDF71', breakfast: '\uD83E\uDD5E',
  honey: '\uD83C\uDF6F', butter: '\uD83E\uDDC8', salt: '\uD83E\uDDC2', pepper: '\uD83C\uDF36\uFE0F',
  'ice cream': '\uD83C\uDF68',

  // Objects & Things
  book: '\uD83D\uDCDA', pen: '\uD83D\uDD8A\uFE0F', pencil: '\u270F\uFE0F', paper: '\uD83D\uDCC4',
  letter: '\u2709\uFE0F', key: '\uD83D\uDD11', clock: '\u23F0', bell: '\uD83D\uDD14',
  ball: '\u26BD', toy: '\uD83E\uDDF8', game: '\uD83C\uDFAE', gift: '\uD83C\uDF81',
  box: '\uD83D\uDCE6', bag: '\uD83D\uDC5C', hat: '\uD83E\uDDE2', shoe: '\uD83D\uDC5F',
  shirt: '\uD83D\uDC55', dress: '\uD83D\uDC57', coat: '\uD83E\uDDE5', bed: '\uD83D\uDECF\uFE0F',
  chair: '\uD83E\uDE91', table: '\uD83E\uDE91', cup: '\u2615', plate: '\uD83C\uDF7D\uFE0F',
  bottle: '\uD83C\uDF76', candle: '\uD83D\uDD6F\uFE0F', lamp: '\uD83D\uDCA1', mirror: '\uD83E\uDE9E',
  flag: '\uD83C\uDFF3\uFE0F', map: '\uD83D\uDDFA\uFE0F', picture: '\uD83D\uDDBC\uFE0F',
  camera: '\uD83D\uDCF7', phone: '\uD83D\uDCF1', computer: '\uD83D\uDCBB', money: '\uD83D\uDCB0',
  coin: '\uD83E\uDE99', crown: '\uD83D\uDC51', ring: '\uD83D\uDC8D', sword: '\u2694\uFE0F',
  shield: '\uD83D\uDEE1\uFE0F', wand: '\uD83E\uDE84', broom: '\uD83E\uDDF9', rope: '\uD83E\uDEA2',
  wheel: '\u2699\uFE0F', boat: '\u26F5', ship: '\uD83D\uDEA2', car: '\uD83D\uDE97',
  bus: '\uD83D\uDE8C', train: '\uD83D\uDE82', airplane: '\u2708\uFE0F', rocket: '\uD83D\uDE80',
  bike: '\uD83D\uDEB2', bicycle: '\uD83D\uDEB2', truck: '\uD83D\uDE9A', wagon: '\uD83D\uDE9A',
  basket: '\uD83E\uDDFA', bucket: '\uD83E\uDEA3', stick: '\uD83E\uDEBA', net: '\uD83E\uDD4F',
  drum: '\uD83E\uDD41', guitar: '\uD83C\uDFB8', piano: '\uD83C\uDFB9', horn: '\uD83D\uDCEF',
  song: '\uD83C\uDFB5', music: '\uD83C\uDFB6', note: '\uD83C\uDFB5',
  tool: '\uD83D\uDD27', hammer: '\uD83D\uDD28', knife: '\uD83D\uDD2A', needle: '\uD83E\uDEA1',
  thread: '\uD83E\uDDF5', chain: '\u26D3\uFE0F', sign: '\uD83E\uDEA7',
  treasure: '\uD83D\uDC8E', gem: '\uD83D\uDC8E', diamond: '\uD83D\uDC8E', gold: '\uD83E\uDE99',

  // Time & Abstract (with visual representations)
  day: '\uD83C\uDF05', night: '\uD83C\uDF03', morning: '\uD83C\uDF05', evening: '\uD83C\uDF07',
  summer: '\u2600\uFE0F', winter: '\u2744\uFE0F', spring: '\uD83C\uDF38', fall: '\uD83C\uDF42',
  year: '\uD83D\uDCC5', time: '\u23F0', dream: '\uD83D\uDCAD', idea: '\uD83D\uDCA1',
  magic: '\u2728', spell: '\u2728', wish: '\uD83C\uDF1F', secret: '\uD83E\uDD2B',
  story: '\uD83D\uDCDA', adventure: '\uD83E\uDDED', journey: '\uD83E\uDDED',
  voice: '\uD83D\uDDE3\uFE0F', sound: '\uD83D\uDD0A', word: '\uD83D\uDCAC', name: '\uD83C\uDFF7\uFE0F',
  color: '\uD83C\uDFA8', light: '\uD83D\uDCA1', shadow: '\uD83D\uDC64', darkness: '\uD83C\uDF11',
  smile: '\uD83D\uDE0A', tear: '\uD83D\uDE22', laugh: '\uD83D\uDE02',
  power: '\uD83D\uDCAA', strength: '\uD83D\uDCAA', speed: '\uD83D\uDCA8',
  war: '\u2694\uFE0F', peace: '\u262E\uFE0F', love: '\u2764\uFE0F',
  life: '\uD83C\uDF31', death: '\uD83D\uDC80',
  trouble: '\u26A0\uFE0F', problem: '\u2753', question: '\u2753', answer: '\u2714\uFE0F',
  luck: '\uD83C\uDF40', hope: '\uD83C\uDF1F', fear: '\uD83D\uDE28',
  truth: '\u2714\uFE0F', lie: '\u274C',
  thing: '\uD83D\uDCE6', stuff: '\uD83D\uDCE6', place: '\uD83D\uDCCD',
  side: '\u27A1\uFE0F', end: '\uD83C\uDFC1', beginning: '\uD83C\uDFC1',
  top: '\u2B06\uFE0F', bottom: '\u2B07\uFE0F', middle: '\u23FA\uFE0F',
  part: '\uD83E\uDDE9', piece: '\uD83E\uDDE9', group: '\uD83D\uDC65',
  way: '\u27A1\uFE0F', step: '\uD83D\uDC63',
};

export default NOUN_EMOJI;
