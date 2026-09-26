'use strict';

/**
 * Catalogue éditorial des banques média et des repères de recherche africains.
 *
 * Ce fichier ne promet pas qu'un fournisseur possède un contenu pour chaque
 * pays. Il décrit ce qui est réellement interrogé par lib/media.js, ce qui
 * nécessite une clé et ce qui doit rester un lien de consultation manuelle.
 * Les alias servent à construire des requêtes précises : un résultat trouvé
 * pour « Africa » ne devient jamais automatiquement un résultat du Burkina,
 * du Mali ou du Niger.
 */

const PROVIDERS = [
  {
    id: 'wikimedia', label: 'Wikimedia Commons', url: 'https://commons.wikimedia.org/',
    status: 'integrated', access: 'libre', kinds: ['image', 'video'],
    license: 'CC / domaine public, à vérifier fichier par fichier',
    note: 'Images et fichiers vidéo avec page source et licence.',
  },
  {
    id: 'openverse', label: 'Openverse', url: 'https://openverse.org/',
    status: 'integrated', access: 'libre', kinds: ['image'],
    license: 'Creative Commons / domaine public, attribution fréquente',
    note: 'Catalogue ouvert d’images ; la licence est renvoyée par asset.',
  },
  {
    id: 'archive', label: 'Internet Archive', url: 'https://archive.org/',
    status: 'integrated', access: 'libre', kinds: ['image', 'video', 'archive'],
    license: 'CC ou domaine public uniquement dans la recherche studio',
    note: 'Archives historiques et films ; disponibilité variable.',
  },
  {
    id: 'nasa', label: 'NASA Image Library', url: 'https://images.nasa.gov/',
    status: 'integrated', access: 'libre', kinds: ['image'],
    license: 'Domaine public selon les règles NASA',
    note: 'Utile pour satellites, climat, géographie et infrastructures.',
  },
  {
    id: 'pexels', label: 'Pexels', url: 'https://www.pexels.com/',
    status: 'integrated', access: 'clé API', kinds: ['image', 'video'],
    license: 'Pexels License ; lien retour recommandé par l’API',
    note: 'Source prioritaire de clips HD quand PEXELS_API_KEY est configurée.',
  },
  {
    id: 'pixabay', label: 'Pixabay', url: 'https://pixabay.com/',
    status: 'integrated', access: 'clé API', kinds: ['image', 'video'],
    license: 'Pixabay Content License ; cache et lien retour requis par l’API',
    note: 'Photos et vidéos ; clé optionnelle dans la configuration.',
  },
  {
    id: 'coverr', label: 'Coverr', url: 'https://coverr.co/',
    status: 'integrated', access: 'clé API', kinds: ['video'],
    license: 'Coverr API License ; attribution requise',
    note: 'Clips curatés HD/4K ; utilisé pour renforcer le B-roll premium.',
  },
  {
    id: 'unsplash', label: 'Unsplash', url: 'https://unsplash.com/',
    status: 'integrated', access: 'clé API', kinds: ['image'],
    license: 'Unsplash License ; attribution et règles API à respecter',
    note: 'Photographie éditoriale premium, sans endpoint vidéo.',
  },
  {
    id: 'web', label: 'Presse et web indexé', url: 'https://www.gdeltproject.org/',
    status: 'integrated', access: 'variable', kinds: ['image', 'actualité'],
    license: 'Usage éditorial : crédit et droits à vérifier',
    note: 'Bing, DuckDuckGo et GDELT : jamais présenté comme libre par défaut.',
  },
  {
    id: 'shutterstock', label: 'Shutterstock', url: 'https://www.shutterstock.com/',
    status: 'integrated', access: 'clé et licence commerciale', kinds: ['image', 'video'],
    license: 'Licence Shutterstock requise',
    note: 'Résultats proposés uniquement si les clés sont configurées ; pas de faux aperçu.',
  },
  {
    id: 'manual-africa', label: 'Portails africains et institutionnels',
    url: 'https://www.afdb.org/en/news-and-events/multimedia', status: 'manual',
    access: 'consultation manuelle', kinds: ['image', 'archive'],
    license: 'Droits variables : demander ou vérifier l’autorisation',
    note: 'Pistes éditoriales : AfDB, UA, agences et médias africains. Aucun scraping silencieux.',
  },
  {
    id: 'manual-mixkit', label: 'Mixkit', url: 'https://mixkit.co/free-stock-video/', status: 'manual',
    access: 'consultation manuelle', kinds: ['video'],
    license: 'Mixkit Free License, vérifier les restrictions par asset',
    note: 'Clips curatés ; pas d’API publique branchée au pipeline.',
  },
  {
    id: 'manual-videvo', label: 'Videvo', url: 'https://www.videvo.net/', status: 'manual',
    access: 'consultation manuelle', kinds: ['video'],
    license: 'Licence variable, attribution parfois requise',
    note: 'Source complémentaire ; pas de téléchargement automatique sans licence explicite.',
  },
  {
    id: 'manual-videezy', label: 'Videezy', url: 'https://www.videezy.com/', status: 'manual',
    access: 'consultation manuelle', kinds: ['video'],
    license: 'Licence variable, attribution à vérifier',
    note: 'Source complémentaire ; chaque clip doit être contrôlé avant montage.',
  },
  {
    id: 'manual-dareful', label: 'Dareful', url: 'https://dareful.com/', status: 'manual',
    access: 'consultation manuelle', kinds: ['video'],
    license: 'CC BY 4.0, crédit obligatoire',
    note: 'Séquences nature et paysages ; import manuel avec crédit.',
  },
  {
    id: 'manual-mazwai', label: 'Mazwai', url: 'https://mazwai.com/', status: 'manual',
    access: 'consultation manuelle', kinds: ['video'],
    license: 'Licence par clip, attribution fréquente',
    note: 'Sélection cinématographique ; pas d’API publique branchée.',
  },
];

// 54 États africains. Les trois pays prioritaires portent un ordre explicite.
const COUNTRIES = [
  { code: 'DZ', name: 'Algérie', en: 'Algeria', capital: 'Alger', region: 'Afrique du Nord', cities: ['Oran', 'Constantine', 'Tamanrasset'], aliases: ['algerie', 'algeria', 'algiers', 'kabylie', 'amazigh', 'berbere', 'tamazight'] },
  { code: 'AO', name: 'Angola', en: 'Angola', capital: 'Luanda', region: 'Afrique australe', cities: ['Benguela', 'Huambo', 'Lubango'], aliases: ['luanda', 'kikongo', 'kimbundu', 'ovimbundu', 'portuguese'] },
  { code: 'BJ', name: 'Bénin', en: 'Benin', capital: 'Porto-Novo', region: 'Afrique de l’Ouest', cities: ['Cotonou', 'Abomey', 'Parakou'], aliases: ['benin', 'benin', 'porto novo', 'cotonou', 'fon', 'yoruba', 'fongbe'] },
  { code: 'BW', name: 'Botswana', en: 'Botswana', capital: 'Gaborone', region: 'Afrique australe', cities: ['Francistown', 'Maun', 'Kasane'], aliases: ['botswana', 'gaborone', 'tswana', 'setswana', 'okavango'] },
  { code: 'BF', name: 'Burkina Faso', en: 'Burkina Faso', capital: 'Ouagadougou', region: 'Afrique de l’Ouest', priority: 1, cities: ['Bobo-Dioulasso', 'Koudougou', 'Banfora', 'Dori', 'Fada N’Gourma'], aliases: ['burkina', 'burkina faso', 'ouagadougou', 'ouaga', 'bobo dioulasso', 'haute volta', 'upper volta', 'mossi', 'moore', 'dioula', 'fulani', 'peul', 'senoufo', 'gourmantche', 'bissa'] },
  { code: 'BI', name: 'Burundi', en: 'Burundi', capital: 'Gitega', region: 'Afrique de l’Est', cities: ['Bujumbura', 'Ngozi', 'Rumonge'], aliases: ['burundi', 'gitega', 'bujumbura', 'kirundi', 'hutu', 'tutsi', 'twa'] },
  { code: 'CV', name: 'Cabo Verde', en: 'Cape Verde', capital: 'Praia', region: 'Afrique de l’Ouest', cities: ['Mindelo', 'Assomada', 'Santa Maria'], aliases: ['cape verde', 'cap vert', 'cabo verde', 'praia', 'mindelo', 'kriolu', 'creole'] },
  { code: 'CM', name: 'Cameroun', en: 'Cameroon', capital: 'Yaoundé', region: 'Afrique centrale', cities: ['Douala', 'Bamenda', 'Garoua', 'Bafoussam'], aliases: ['cameroun', 'cameroon', 'yaounde', 'douala', 'bamenda', 'bassa', 'duala', 'fulani', 'ewondo', 'anglais', 'francais'] },
  { code: 'CF', name: 'République centrafricaine', en: 'Central African Republic', capital: 'Bangui', region: 'Afrique centrale', cities: ['Berbérati', 'Bambari', 'Bouar'], aliases: ['centrafrique', 'central african republic', 'bangui', 'sango', 'gbaya', 'banda'] },
  { code: 'TD', name: 'Tchad', en: 'Chad', capital: 'N’Djamena', region: 'Afrique centrale', cities: ['Moundou', 'Abéché', 'Sarh'], aliases: ['tchad', 'chad', 'ndjamena', 'n djamena', 'kanembu', 'toubou', 'zaghawa', 'arabe tchadien'] },
  { code: 'KM', name: 'Comores', en: 'Comoros', capital: 'Moroni', region: 'Afrique de l’Est', cities: ['Mutsamudu', 'Fomboni', 'Mamoudzou'], aliases: ['comores', 'comoros', 'moroni', 'shimaore', 'comorian', 'anjouan', 'mayotte'] },
  { code: 'CG', name: 'République du Congo', en: 'Republic of the Congo', capital: 'Brazzaville', region: 'Afrique centrale', cities: ['Pointe-Noire', 'Dolisie', 'Ouesso'], aliases: ['congo brazzaville', 'republic of the congo', 'brazzaville', 'pointe noire', 'lingala', 'kituba', 'kongo'] },
  { code: 'CD', name: 'République démocratique du Congo', en: 'Democratic Republic of the Congo', capital: 'Kinshasa', region: 'Afrique centrale', cities: ['Lubumbashi', 'Goma', 'Kisangani', 'Bukavu', 'Mbuji-Mayi'], aliases: ['rdc', 'rd congo', 'congo kinshasa', 'democratic republic of the congo', 'kinshasa', 'lubumbashi', 'goma', 'swahili', 'lingala', 'kikongo', 'tshiluba'] },
  { code: 'CI', name: 'Côte d’Ivoire', en: 'Ivory Coast', capital: 'Yamoussoukro', region: 'Afrique de l’Ouest', cities: ['Abidjan', 'Bouaké', 'Korhogo', 'San-Pédro'], aliases: ['cote ivoire', 'cote d ivoire', 'ivory coast', 'yamoussoukro', 'abidjan', 'bouake', 'baoule', 'dioula', 'senoufo', 'akan'] },
  { code: 'DJ', name: 'Djibouti', en: 'Djibouti', capital: 'Djibouti', region: 'Afrique de l’Est', cities: ['Ali Sabieh', 'Tadjourah', 'Obock'], aliases: ['djibouti', 'djibouti ville', 'afar', 'issas', 'somali', 'tadjourah'] },
  { code: 'EG', name: 'Égypte', en: 'Egypt', capital: 'Le Caire', region: 'Afrique du Nord', cities: ['Alexandrie', 'Gizeh', 'Louxor', 'Assouan', 'Port-Saïd'], aliases: ['egypte', 'egypt', 'cairo', 'le caire', 'alexandria', 'nile', 'nubian', 'nubien', 'arabe egyptien', 'sinaï'] },
  { code: 'GQ', name: 'Guinée équatoriale', en: 'Equatorial Guinea', capital: 'Malabo', region: 'Afrique centrale', cities: ['Bata', 'Ebebiyin', 'Luba'], aliases: ['guinee equatoriale', 'equatorial guinea', 'malabo', 'bata', 'fang', 'bubi', 'spanish'] },
  { code: 'ER', name: 'Érythrée', en: 'Eritrea', capital: 'Asmara', region: 'Afrique de l’Est', cities: ['Massawa', 'Keren', 'Mendefera'], aliases: ['erythree', 'eritrea', 'asmara', 'massawa', 'tigrinya', 'tigre', 'afar'] },
  { code: 'SZ', name: 'Eswatini', en: 'Eswatini', capital: 'Mbabane', region: 'Afrique australe', cities: ['Manzini', 'Lobamba', 'Siteki'], aliases: ['eswatini', 'swaziland', 'mbabane', 'manzini', 'swazi', 'siswati'] },
  { code: 'ET', name: 'Éthiopie', en: 'Ethiopia', capital: 'Addis-Abeba', region: 'Afrique de l’Est', cities: ['Dire Dawa', 'Mekele', 'Gondar', 'Bahir Dar'], aliases: ['ethiopie', 'ethiopia', 'addis ababa', 'addis abeba', 'oromo', 'amharique', 'amharic', 'tigray', 'tigrinya', 'afar'] },
  { code: 'GA', name: 'Gabon', en: 'Gabon', capital: 'Libreville', region: 'Afrique centrale', cities: ['Port-Gentil', 'Franceville', 'Oyem'], aliases: ['gabon', 'libreville', 'port gentil', 'fang', 'punu', 'nzebi'] },
  { code: 'GM', name: 'Gambie', en: 'The Gambia', capital: 'Banjul', region: 'Afrique de l’Ouest', cities: ['Serekunda', 'Brikama', 'Bakau'], aliases: ['gambie', 'gambia', 'banjul', 'serekunda', 'mandinka', 'wolof', 'fula'] },
  { code: 'GH', name: 'Ghana', en: 'Ghana', capital: 'Accra', region: 'Afrique de l’Ouest', cities: ['Kumasi', 'Tamale', 'Takoradi', 'Cape Coast'], aliases: ['ghana', 'accra', 'kumasi', 'ashanti', 'akan', 'ewe', 'ga', 'dagomba', 'twi'] },
  { code: 'GN', name: 'Guinée', en: 'Guinea', capital: 'Conakry', region: 'Afrique de l’Ouest', cities: ['Kankan', 'Labé', 'Nzérékoré'], aliases: ['guinee', 'guinea', 'conakry', 'kankan', 'labe', 'peul', 'fulani', 'malinké', 'soussou'] },
  { code: 'GW', name: 'Guinée-Bissau', en: 'Guinea-Bissau', capital: 'Bissau', region: 'Afrique de l’Ouest', cities: ['Bafatá', 'Cacheu', 'Bolama'], aliases: ['guinee bissau', 'guinea bissau', 'bissau', 'balanta', 'fula', 'mandinka', 'bijago'] },
  { code: 'KE', name: 'Kenya', en: 'Kenya', capital: 'Nairobi', region: 'Afrique de l’Est', cities: ['Mombasa', 'Kisumu', 'Nakuru', 'Eldoret'], aliases: ['kenya', 'nairobi', 'mombasa', 'maasai', 'masai', 'kikuyu', 'luo', 'swahili'] },
  { code: 'LS', name: 'Lesotho', en: 'Lesotho', capital: 'Maseru', region: 'Afrique australe', cities: ['Teyateyaneng', 'Mafeteng', 'Butha-Buthe'], aliases: ['lesotho', 'maseru', 'basotho', 'sesotho', 'maloti'] },
  { code: 'LR', name: 'Liberia', en: 'Liberia', capital: 'Monrovia', region: 'Afrique de l’Ouest', cities: ['Gbarnga', 'Buchanan', 'Ganta'], aliases: ['liberia', 'monrovia', 'kru', 'kpelle', 'bassa', 'english'] },
  { code: 'LY', name: 'Libye', en: 'Libya', capital: 'Tripoli', region: 'Afrique du Nord', cities: ['Benghazi', 'Misrata', 'Sabha'], aliases: ['libye', 'libya', 'tripoli', 'benghazi', 'touareg', 'amazigh', 'arabe'] },
  { code: 'MG', name: 'Madagascar', en: 'Madagascar', capital: 'Antananarivo', region: 'Afrique de l’Est', cities: ['Toamasina', 'Antsirabe', 'Mahajanga', 'Fianarantsoa'], aliases: ['madagascar', 'antananarivo', 'tananarive', 'malagasy', 'merina', 'betsimisaraka'] },
  { code: 'MW', name: 'Malawi', en: 'Malawi', capital: 'Lilongwe', region: 'Afrique australe', cities: ['Blantyre', 'Mzuzu', 'Zomba'], aliases: ['malawi', 'lilongwe', 'blantyre', 'chewa', 'chichewa', 'tumbuka', 'yao'] },
  { code: 'ML', name: 'Mali', en: 'Mali', capital: 'Bamako', region: 'Afrique de l’Ouest', priority: 1, cities: ['Sikasso', 'Mopti', 'Tombouctou', 'Gao', 'Ségou', 'Kayes'], aliases: ['mali', 'bamako', 'timbuktu', 'tombouctou', 'mopti', 'gao', 'segou', 'sikasso', 'mandingue', 'bambara', 'bamanankan', 'songhai', 'sonrai', 'dogon', 'fulani', 'peul', 'touareg', 'tamacheq'] },
  { code: 'MR', name: 'Mauritanie', en: 'Mauritania', capital: 'Nouakchott', region: 'Afrique de l’Ouest', cities: ['Nouadhibou', 'Atar', 'Chinguetti'], aliases: ['mauritanie', 'mauritania', 'nouakchott', 'atar', 'chinguetti', 'hassaniya', 'soninke', 'wolof', 'pulaar', 'touareg'] },
  { code: 'MU', name: 'Maurice', en: 'Mauritius', capital: 'Port-Louis', region: 'Afrique de l’Est', cities: ['Beau Bassin-Rose Hill', 'Curepipe', 'Mahébourg'], aliases: ['maurice', 'mauritius', 'port louis', 'creole mauricien', 'mauritian creole'] },
  { code: 'MA', name: 'Maroc', en: 'Morocco', capital: 'Rabat', region: 'Afrique du Nord', cities: ['Casablanca', 'Marrakech', 'Fès', 'Tanger', 'Agadir'], aliases: ['maroc', 'morocco', 'rabat', 'casablanca', 'marrakech', 'fes', 'amazigh', 'berbere', 'rif', 'atlas'] },
  { code: 'MZ', name: 'Mozambique', en: 'Mozambique', capital: 'Maputo', region: 'Afrique australe', cities: ['Beira', 'Nampula', 'Pemba', 'Quelimane'], aliases: ['mozambique', 'maputo', 'beira', 'makua', 'tsonga', 'sena', 'portuguese'] },
  { code: 'NA', name: 'Namibie', en: 'Namibia', capital: 'Windhoek', region: 'Afrique australe', cities: ['Swakopmund', 'Walvis Bay', 'Oshakati'], aliases: ['namibie', 'namibia', 'windhoek', 'sossusvlei', 'ovambo', 'herero', 'nama', 'san'] },
  { code: 'NE', name: 'Niger', en: 'Niger', capital: 'Niamey', region: 'Afrique de l’Ouest', priority: 1, cities: ['Agadez', 'Zinder', 'Maradi', 'Diffa', 'Tahoua'], aliases: ['niger', 'niamey', 'agadez', 'zinder', 'maradi', 'sahel', 'haoussa', 'hausawa', 'zarma', 'songhai', 'touareg', 'tamasheq', 'fulani', 'peul', 'kanuri'] },
  { code: 'NG', name: 'Nigéria', en: 'Nigeria', capital: 'Abuja', region: 'Afrique de l’Ouest', cities: ['Lagos', 'Kano', 'Ibadan', 'Port Harcourt', 'Enugu'], aliases: ['nigeria', 'nigerian', 'abuja', 'lagos', 'kano', 'yoruba', 'igbo', 'hausa', 'fulani', 'pidgin'] },
  { code: 'RW', name: 'Rwanda', en: 'Rwanda', capital: 'Kigali', region: 'Afrique de l’Est', cities: ['Butare', 'Musanze', 'Gisenyi'], aliases: ['rwanda', 'kigali', 'ruanda', 'kinyarwanda', 'hutu', 'tutsi', 'twa'] },
  { code: 'ST', name: 'São Tomé-et-Príncipe', en: 'São Tomé and Príncipe', capital: 'São Tomé', region: 'Afrique centrale', cities: ['Santo António', 'Trindade', 'Neves'], aliases: ['sao tome', 'sao tome and principe', 'sao tome principe', 'santome', 'forro', 'portuguese'] },
  { code: 'SN', name: 'Sénégal', en: 'Senegal', capital: 'Dakar', region: 'Afrique de l’Ouest', cities: ['Thiès', 'Saint-Louis', 'Touba', 'Ziguinchor'], aliases: ['senegal', 'dakar', 'thies', 'saint louis senegal', 'wolof', 'serer', 'pulaar', 'diola', 'mouride'] },
  { code: 'SC', name: 'Seychelles', en: 'Seychelles', capital: 'Victoria', region: 'Afrique de l’Est', cities: ['Anse Royale', 'Beau Vallon'], aliases: ['seychelles', 'victoria seychelles', 'seychellois creole'] },
  { code: 'SL', name: 'Sierra Leone', en: 'Sierra Leone', capital: 'Freetown', region: 'Afrique de l’Ouest', cities: ['Bo', 'Kenema', 'Makeni'], aliases: ['sierra leone', 'freetown', 'temne', 'mende', 'krio'] },
  { code: 'SO', name: 'Somalie', en: 'Somalia', capital: 'Mogadiscio', region: 'Afrique de l’Est', cities: ['Hargeisa', 'Kismayo', 'Bosaso'], aliases: ['somalie', 'somalia', 'mogadishu', 'mogadiscio', 'hargeisa', 'somali', 'puntland', 'somaliland'] },
  { code: 'ZA', name: 'Afrique du Sud', en: 'South Africa', capital: 'Pretoria', region: 'Afrique australe', cities: ['Johannesburg', 'Le Cap', 'Cape Town', 'Durban', 'Soweto'], aliases: ['afrique du sud', 'south africa', 'pretoria', 'johannesburg', 'cape town', 'durban', 'soweto', 'zulu', 'xhosa', 'afrikaans'] },
  { code: 'SS', name: 'Soudan du Sud', en: 'South Sudan', capital: 'Djouba', region: 'Afrique de l’Est', cities: ['Wau', 'Malakal', 'Yei'], aliases: ['soudan du sud', 'south sudan', 'juba', 'djouba', 'dinka', 'nuer', 'shilluk'] },
  { code: 'SD', name: 'Soudan', en: 'Sudan', capital: 'Khartoum', region: 'Afrique du Nord', cities: ['Omdurman', 'Port-Soudan', 'Nyala', 'El Obeid'], aliases: ['soudan', 'sudan', 'khartoum', 'omdurman', 'nubian', 'nubien', 'arabe soudanais', 'darfur'] },
  { code: 'TZ', name: 'Tanzanie', en: 'Tanzania', capital: 'Dodoma', region: 'Afrique de l’Est', cities: ['Dar es Salaam', 'Arusha', 'Mwanza', 'Zanzibar'], aliases: ['tanzanie', 'tanzania', 'dodoma', 'dar es salaam', 'zanzibar', 'swahili', 'chagga', 'maasai'] },
  { code: 'TG', name: 'Togo', en: 'Togo', capital: 'Lomé', region: 'Afrique de l’Ouest', cities: ['Sokodé', 'Kara', 'Atakpamé'], aliases: ['togo', 'lome', 'sokode', 'kabyé', 'ewe', 'mina', 'tem'] },
  { code: 'TN', name: 'Tunisie', en: 'Tunisia', capital: 'Tunis', region: 'Afrique du Nord', cities: ['Sfax', 'Sousse', 'Djerba', 'Kairouan'], aliases: ['tunisie', 'tunisia', 'tunis', 'sfax', 'sousse', 'djerba', 'amazigh', 'arabe tunisien'] },
  { code: 'UG', name: 'Ouganda', en: 'Uganda', capital: 'Kampala', region: 'Afrique de l’Est', cities: ['Entebbe', 'Jinja', 'Gulu', 'Mbarara'], aliases: ['ouganda', 'uganda', 'kampala', 'entebbe', 'buganda', 'luganda', 'acholi', 'swahili'] },
  { code: 'ZM', name: 'Zambie', en: 'Zambia', capital: 'Lusaka', region: 'Afrique australe', cities: ['Kitwe', 'Ndola', 'Livingstone'], aliases: ['zambie', 'zambia', 'lusaka', 'livingstone', 'bemba', 'tonga', 'lozi', 'chewa'] },
  { code: 'ZW', name: 'Zimbabwe', en: 'Zimbabwe', capital: 'Harare', region: 'Afrique australe', cities: ['Bulawayo', 'Mutare', 'Victoria Falls'], aliases: ['zimbabwe', 'harare', 'bulawayo', 'victoria falls', 'shona', 'ndebele'] },
];

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

const INDEX = COUNTRIES.map(country => ({ country, hay: normalize([
  country.name, country.en, country.capital, country.region, ...(country.cities || []), ...(country.aliases || []),
].join(' ')) }));

function matches(query) {
  const hay = normalize(query);
  if (!hay) return [];
  return INDEX.filter(x => x.country.aliases.concat([
    x.country.name, x.country.en, x.country.capital, x.country.code,
    ...(x.country.cities || []), x.country.region,
  ]).some(term => {
    const t = normalize(term);
    return t && (hay === t || hay.includes(` ${t} `) || hay.startsWith(`${t} `)
      || hay.endsWith(` ${t}`));
  })).map(x => x.country).sort((a, b) => (a.priority || 9) - (b.priority || 9));
}

/**
 * Ajoute un ancrage local sans transformer une recherche « Afrique » en
 * prétendue recherche d'un pays précis. Une seule requête enrichie est
 * utilisée par fournisseur : les titres restent libres et le filtre de
 * pertinence de media.js fait le tri.
 */
const GENERIC_GEO_TERMS = new Set([
  'afrique', 'africa', 'afrique de ouest', 'afrique de est', 'afrique centrale',
  'afrique du nord', 'afrique australe', 'west africa', 'east africa',
  'central africa', 'north africa', 'southern africa', 'sahel', 'sahara',
]);
function hasTerm(normalized, term) {
  const t = normalize(term);
  return t && (normalized === t || normalized.includes(` ${t} `)
    || normalized.startsWith(`${t} `) || normalized.endsWith(` ${t}`));
}

function enrichQuery(query) {
  const original = String(query || '').trim();
  const found = matches(original);
  if (!found.length) return { query: original, countries: [], country: null };
  const normalized = normalize(original);
  /* Une région (« Afrique de l’Ouest », « Sahel ») ne doit pas être
   * arbitrairement convertie en Burkina Faso parce que ce pays est prioritaire.
   * Un nom de pays, une capitale ou une ville est un ancrage sûr. */
  const explicit = found.filter(country => [
    country.name, country.en, country.capital, country.code, ...(country.cities || []),
  ].some(term => hasTerm(normalized, term)));
  let specific = explicit;
  if (!specific.length) {
    /* Un peuple ou une langue peut être une requête utile, mais certains
     * termes traversent plusieurs frontières (fulani, haoussa, swahili…).
     * Nous n'ancrons que le terme non générique qui n'appartient qu'à un seul
     * pays du catalogue. */
    const aliases = found.flatMap(country => (country.aliases || []).map(alias => ({ country, alias })))
      .filter(x => !GENERIC_GEO_TERMS.has(normalize(x.alias)) && hasTerm(normalized, x.alias));
    const uniques = aliases.filter(x => aliases.filter(y => normalize(y.alias) === normalize(x.alias))
      .every(y => y.country.code === x.country.code));
    specific = uniques.length ? [uniques[0].country] : [];
  }
  if (!specific.length) return { query: original, countries: found, country: null };
  const country = specific[0];
  const anchor = [...new Set([country.name, country.en, country.capital].filter(Boolean))].join(' ');
  const enriched = hasTerm(normalized, country.capital) ? original : `${original} ${anchor}`;
  return { query: enriched.trim(), countries: specific, country };
}

function providerStates(keys = {}) {
  return PROVIDERS.map(provider => ({
    ...provider,
    configured: provider.access !== 'clé API' && provider.access !== 'clé et licence commerciale'
      ? true
      : provider.id === 'pexels' ? !!keys.pexels
        : provider.id === 'pixabay' ? !!keys.pixabay
          : provider.id === 'coverr' ? !!keys.coverr
            : provider.id === 'unsplash' ? !!keys.unsplash
            : provider.id === 'shutterstock' ? !!(keys.shutterstock_key && keys.shutterstock_secret)
              : false,
  }));
}

function publicCatalog(keys = {}) {
  return {
    providers: providerStates(keys),
    countries: COUNTRIES.map(({ code, name, en, capital, region, cities, priority }) => ({
      code, name, en, capital, region, cities, priority: priority || 0,
    })),
    priority: COUNTRIES.filter(c => c.priority).map(c => ({
      code: c.code, name: c.name, en: c.en, capital: c.capital, cities: c.cities,
    })),
    coverage: { countries: COUNTRIES.length, regions: [...new Set(COUNTRIES.map(c => c.region))].length },
  };
}

module.exports = { PROVIDERS, COUNTRIES, matches, enrichQuery, providerStates, publicCatalog, normalize };
