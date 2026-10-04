'use strict';

// Each entry: [question, correctAnswer, wrong1, wrong2, wrong3]
// Choices are shuffled per match, so the correct answer is always listed first here.
const BANK = {
  'General Knowledge': [
    ['How many sides does a hexagon have?', '6', '5', '7', '8'],
    ['What is the largest ocean on Earth?', 'Pacific', 'Atlantic', 'Indian', 'Arctic'],
    ['How many minutes are in a full day?', '1,440', '1,200', '1,560', '2,400'],
    ['Which color do you get by mixing blue and yellow paint?', 'Green', 'Purple', 'Orange', 'Brown'],
    ['How many players are on the field for one soccer team?', '11', '10', '9', '12'],
    ['What is the hardest natural substance?', 'Diamond', 'Quartz', 'Titanium', 'Granite'],
    ['How many continents are there?', '7', '5', '6', '8'],
    ['Which month has the fewest days?', 'February', 'April', 'June', 'November'],
    ['What do bees produce?', 'Honey', 'Silk', 'Wax paper', 'Nectar'],
    ['Which instrument has 88 keys?', 'Piano', 'Organ', 'Accordion', 'Harpsichord'],
  ],
  Science: [
    ['What is the chemical symbol for gold?', 'Au', 'Ag', 'Gd', 'Go'],
    ['What planet is known as the Red Planet?', 'Mars', 'Venus', 'Jupiter', 'Mercury'],
    ['What gas do plants absorb from the air?', 'Carbon dioxide', 'Oxygen', 'Nitrogen', 'Helium'],
    ['How many bones are in the adult human body?', '206', '186', '226', '256'],
    ['What is H2O more commonly called?', 'Water', 'Hydrogen peroxide', 'Salt', 'Ozone'],
    ['What is the closest star to Earth?', 'The Sun', 'Proxima Centauri', 'Sirius', 'Polaris'],
    ['Which organ pumps blood through the body?', 'Heart', 'Liver', 'Lungs', 'Kidneys'],
    ['What part of the cell is called the powerhouse?', 'Mitochondria', 'Nucleus', 'Ribosome', 'Golgi body'],
    ['At what temperature does water boil at sea level (°C)?', '100', '90', '110', '212'],
    ['What force keeps us on the ground?', 'Gravity', 'Magnetism', 'Friction', 'Inertia'],
  ],
  History: [
    ['In what year did World War II end?', '1945', '1939', '1944', '1950'],
    ['Who was the first President of the United States?', 'George Washington', 'Thomas Jefferson', 'Abraham Lincoln', 'John Adams'],
    ['Which ancient civilization built the pyramids of Giza?', 'Egyptians', 'Romans', 'Greeks', 'Mayans'],
    ['In what year did humans first land on the Moon?', '1969', '1965', '1972', '1959'],
    ['Which wall fell in 1989?', 'Berlin Wall', 'Great Wall', "Hadrian's Wall", 'Western Wall'],
    ['Who was known as the Maid of Orléans?', 'Joan of Arc', 'Marie Antoinette', 'Catherine de Medici', 'Eleanor of Aquitaine'],
    ['The Titanic sank in which year?', '1912', '1905', '1920', '1898'],
    ['Which empire was ruled by Julius Caesar?', 'Roman', 'Ottoman', 'Persian', 'Byzantine'],
    ['Who wrote the Declaration of Independence (main author)?', 'Thomas Jefferson', 'Benjamin Franklin', 'John Hancock', 'James Madison'],
    ['Which country gifted the Statue of Liberty to the USA?', 'France', 'England', 'Spain', 'Italy'],
  ],
  Geography: [
    ['What is the capital of Japan?', 'Tokyo', 'Osaka', 'Kyoto', 'Seoul'],
    ['Which is the longest river in Africa?', 'Nile', 'Congo', 'Niger', 'Zambezi'],
    ['What is the capital of Australia?', 'Canberra', 'Sydney', 'Melbourne', 'Perth'],
    ['Which country has the largest population as of 2024?', 'India', 'China', 'USA', 'Indonesia'],
    ['Mount Everest sits on the border of Nepal and which other country/region?', 'China (Tibet)', 'India', 'Bhutan', 'Pakistan'],
    ['What is the smallest country in the world?', 'Vatican City', 'Monaco', 'San Marino', 'Liechtenstein'],
    ['Which desert is the largest hot desert?', 'Sahara', 'Gobi', 'Kalahari', 'Mojave'],
    ['What is the capital of Canada?', 'Ottawa', 'Toronto', 'Vancouver', 'Montreal'],
    ['Which US state is made up entirely of islands?', 'Hawaii', 'Alaska', 'Florida', 'Rhode Island'],
    ['Which country is shaped like a boot?', 'Italy', 'Greece', 'Portugal', 'Chile'],
  ],
  'Pop Culture': [
    ['Which wizard has a lightning-bolt scar?', 'Harry Potter', 'Gandalf', 'Merlin', 'Doctor Strange'],
    ['What is the name of the toy cowboy in Toy Story?', 'Woody', 'Buzz', 'Jessie', 'Rex'],
    ['Which superhero is known as the Dark Knight?', 'Batman', 'Superman', 'Iron Man', 'Daredevil'],
    ['Which band sang "Bohemian Rhapsody"?', 'Queen', 'The Beatles', 'Led Zeppelin', 'ABBA'],
    ['What fictional country is Black Panther from?', 'Wakanda', 'Genovia', 'Latveria', 'Sokovia'],
    ['In "Frozen", what is the name of the snowman?', 'Olaf', 'Sven', 'Kristoff', 'Hans'],
    ['Which TV show features the Upside Down?', 'Stranger Things', 'Dark', 'The OA', 'Lost'],
    ['Who is known as the "King of Pop"?', 'Michael Jackson', 'Elvis Presley', 'Prince', 'Justin Timberlake'],
    ['What color is the pill Neo takes in The Matrix?', 'Red', 'Blue', 'Green', 'White'],
    ['Which streaming show is about a deadly children\'s game competition in Korea?', 'Squid Game', 'Alice in Borderland', 'Kingdom', 'All of Us Are Dead'],
  ],
  Sports: [
    ['How many points is a touchdown worth in American football?', '6', '3', '7', '2'],
    ['In which sport would you perform a slam dunk?', 'Basketball', 'Volleyball', 'Tennis', 'Handball'],
    ['How many rings are on the Olympic flag?', '5', '4', '6', '7'],
    ['What is a perfect score in ten-pin bowling?', '300', '200', '250', '100'],
    ['Which country has won the most FIFA World Cups?', 'Brazil', 'Germany', 'Italy', 'Argentina'],
    ['In tennis, what is a score of zero called?', 'Love', 'Nil', 'Duck', 'Zip'],
    ['How long is a marathon (miles, approx.)?', '26.2', '13.1', '20', '30'],
    ['What sport is played at Wimbledon?', 'Tennis', 'Cricket', 'Golf', 'Polo'],
    ['Which sport uses a shuttlecock?', 'Badminton', 'Squash', 'Table tennis', 'Lacrosse'],
    ['How many holes are on a standard golf course?', '18', '9', '12', '21'],
  ],
  Gaming: [
    ['What is the name of the princess Mario usually rescues?', 'Peach', 'Daisy', 'Zelda', 'Rosalina'],
    ['In Minecraft, what material do you need to make a Nether portal?', 'Obsidian', 'Bedrock', 'Netherrack', 'Cobblestone'],
    ['What company makes the PlayStation?', 'Sony', 'Microsoft', 'Nintendo', 'Sega'],
    ['Which game features a battle bus?', 'Fortnite', 'PUBG', 'Apex Legends', 'Warzone'],
    ['What color is Sonic the Hedgehog?', 'Blue', 'Red', 'Green', 'Yellow'],
    ['In Among Us, what is the name for the hidden killer?', 'Impostor', 'Traitor', 'Saboteur', 'Mole'],
    ['Which Pokémon is #25 in the National Pokédex?', 'Pikachu', 'Eevee', 'Jigglypuff', 'Charmander'],
    ['Link is the hero of which game series?', 'The Legend of Zelda', 'Final Fantasy', 'Kingdom Hearts', 'Metroid'],
    ['Tetris was originally created in which country?', 'Soviet Union', 'Japan', 'USA', 'Finland'],
    ['What is the best-selling video game of all time (as of 2024)?', 'Minecraft', 'GTA V', 'Tetris (EA)', 'Wii Sports'],
  ],
  'Internet Culture': [
    ['The famous Omegle tagline was "Talk to ___!"', 'strangers', 'friends', 'anyone', 'robots'],
    ['What does "GOAT" stand for in slang?', 'Greatest Of All Time', 'Going Out All Tonight', 'Good Old American Tradition', 'Game Over, Asking Twice'],
    ['"Rickrolling" uses a song by which artist?', 'Rick Astley', 'Rick James', 'Rick Ross', 'Rick Springfield'],
    ['What does "IRL" mean?', 'In Real Life', 'I Really Laughed', 'Instant Reply Later', 'In Random Lobby'],
    ['Which platform popularized the short vertical "For You" feed?', 'TikTok', 'Vine', 'Snapchat', 'Tumblr'],
    ['In slang, "mogging" someone means you…', 'Outshine them', 'Ignore them', 'Copy them', 'Block them'],
    ['What animal is the "Doge" meme?', 'Shiba Inu', 'Corgi', 'Husky', 'Akita'],
    ['What does "AFK" stand for?', 'Away From Keyboard', 'Always Feeling Kind', 'Ask For Keys', 'Another Fun Kill'],
    ['Which website is known as "the front page of the internet"?', 'Reddit', 'Digg', 'Yahoo', '4chan'],
    ['"NPC" originally comes from which field?', 'Video games', 'Film', 'Politics', 'Sports'],
  ],
};

// Conversation prompts shown during the chat break between rounds.
const TALK_TOPICS = [
  'Hot take: what\'s an overrated movie everyone loves?',
  'If you could master one skill instantly, what would it be?',
  'What\'s the best snack for a late-night study session?',
  'Which fictional world would you actually live in?',
  'What\'s a fact you learned recently that blew your mind?',
  'Cats or dogs — defend your answer in one sentence.',
  'What song is stuck in your head right now?',
  'If you had a trivia specialty, what would it be?',
  'What\'s the most useless talent you have?',
  'Pineapple on pizza: yes or no?',
  'What game have you sunk the most hours into?',
  'Which decade had the best music?',
  'What would your walk-up song be?',
  'If you could ask a historical figure one question, who and what?',
  'What\'s the best advice you\'ve ever gotten?',
  'Trash-talk round: tell your opponent why the next round is yours.',
];

const CATEGORIES = Object.keys(BANK);

function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toQuestion(category, entry, index, rand) {
  const [text, correct, ...wrong] = entry;
  const choices = shuffle([correct, ...wrong], rand);
  return {
    id: `${category}:${index}`,
    category,
    text,
    choices,
    answer: choices.indexOf(correct),
  };
}

/** Pick `count` distinct random categories. */
function pickCategories(count, rand = Math.random) {
  return shuffle(CATEGORIES, rand).slice(0, Math.min(count, CATEGORIES.length));
}

/** Pick `count` random questions from a category with shuffled choices. */
function pickQuestions(category, count, rand = Math.random) {
  const entries = BANK[category];
  if (!entries) throw new Error(`Unknown category: ${category}`);
  const indexes = shuffle(entries.map((_, i) => i), rand).slice(0, count);
  return indexes.map((i) => toQuestion(category, entries[i], i, rand));
}

function pickTopic(rand = Math.random) {
  return TALK_TOPICS[Math.floor(rand() * TALK_TOPICS.length)];
}

module.exports = { BANK, CATEGORIES, TALK_TOPICS, shuffle, pickCategories, pickQuestions, pickTopic };
