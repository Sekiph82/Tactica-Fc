// Flag pr. nationalitet: databasens engelske landenavne → ISO 3166-kode (flagcdn.com, SVG).
const ISO: Record<string, string> = {
  France: 'fr', Brazil: 'br', Italy: 'it', Colombia: 'co', Sweden: 'se', Norway: 'no', Japan: 'jp', Argentina: 'ar', 'Türkiye': 'tr', Turkey: 'tr',
  Spain: 'es', 'United States': 'us', Denmark: 'dk', Ukraine: 'ua', Portugal: 'pt', Russia: 'ru', Netherlands: 'nl', Greece: 'gr', Belgium: 'be',
  England: 'gb-eng', 'Saudi Arabia': 'sa', Croatia: 'hr', Mexico: 'mx', Australia: 'au', Scotland: 'gb-sct', Austria: 'at', 'Czech Republic': 'cz',
  Germany: 'de', Serbia: 'rs', Poland: 'pl', 'Korea, South': 'kr', Switzerland: 'ch', Romania: 'ro', Bulgaria: 'bg', Paraguay: 'py', Hungary: 'hu',
  Georgia: 'ge', 'North Macedonia': 'mk', Peru: 'pe', Belarus: 'by', Canada: 'ca', "Cote d'Ivoire": 'ci', Morocco: 'ma', Montenegro: 'me',
  'Bosnia-Herzegovina': 'ba', Cameroon: 'cm', Angola: 'ao', Tunisia: 'tn', Ireland: 'ie', Iceland: 'is', 'DR Congo': 'cd', Nigeria: 'ng', Wales: 'gb-wls',
  Chile: 'cl', Israel: 'il', Slovakia: 'sk', 'Northern Ireland': 'gb-nir', Grenada: 'gd', Finland: 'fi', Senegal: 'sn', Guinea: 'gn', Tahiti: 'pf',
  'South Africa': 'za', Ghana: 'gh', Moldova: 'md', Mali: 'ml', 'Saint-Martin': 'mf', Martinique: 'mq', Algeria: 'dz', 'French Guiana': 'gf',
  'Réunion': 're', Uruguay: 'uy', Lithuania: 'lt', Albania: 'al', Eritrea: 'er', Egypt: 'eg', 'Cape Verde': 'cv', 'Equatorial Guinea': 'gq', Togo: 'tg',
  Uzbekistan: 'uz', Jamaica: 'jm', 'Trinidad and Tobago': 'tt', Guadeloupe: 'gp', Qatar: 'qa', Rwanda: 'rw', Iran: 'ir', 'Antigua and Barbuda': 'ag',
  'The Gambia': 'gm', Slovenia: 'si', Latvia: 'lv', 'Burkina Faso': 'bf', Armenia: 'am', Estonia: 'ee', Mozambique: 'mz', Burundi: 'bi',
  'Chinese Taipei': 'tw', Barbados: 'bb', Syria: 'sy', Philippines: 'ph', Gabon: 'ga', 'Sierra Leone': 'sl', Curacao: 'cw', Pakistan: 'pk',
  'Faroe Islands': 'fo', Madagascar: 'mg', Zambia: 'zm', Kazakhstan: 'kz', Venezuela: 've', Oman: 'om', Cyprus: 'cy', Azerbaijan: 'az', Kosovo: 'xk',
  'New Zealand': 'nz', 'Guinea-Bissau': 'gw', Congo: 'cg', 'Central African Republic': 'cf', Ecuador: 'ec', Haiti: 'ht', Benin: 'bj', 'Costa Rica': 'cr',
  Kenya: 'ke', Suriname: 'sr', Luxembourg: 'lu', Ethiopia: 'et', Seychelles: 'sc', 'Dominican Republic': 'do', 'El Salvador': 'sv', Zimbabwe: 'zw',
  Andorra: 'ad', Malta: 'mt', Honduras: 'hn', Uganda: 'ug', Comoros: 'km', Guyana: 'gy', Malaysia: 'my', Palestine: 'ps', Aruba: 'aw', 'San Marino': 'sm',
  Malawi: 'mw', Iraq: 'iq', India: 'in', Tajikistan: 'tj', Thailand: 'th', 'Brunei Darussalam': 'bn', Liechtenstein: 'li', Mauritania: 'mr', Niger: 'ne',
  Singapore: 'sg', Bhutan: 'bt', Guatemala: 'gt', Bolivia: 'bo', Liberia: 'lr', Panama: 'pa', Lebanon: 'lb', Chad: 'td', Indonesia: 'id', Libya: 'ly',
  Bangladesh: 'bd', 'Sao Tome and Principe': 'st', Montserrat: 'ms', Turkmenistan: 'tm', 'United Arab Emirates': 'ae', Cuba: 'cu', 'St. Kitts & Nevis': 'kn',
  Nicaragua: 'ni', 'Sri Lanka': 'lk', China: 'cn', Laos: 'la', Mauritius: 'mu', Hongkong: 'hk', Neukaledonien: 'nc', 'St. Lucia': 'lc', Afghanistan: 'af',
  Jordan: 'jo', Bermuda: 'bm', Belize: 'bz', Tanzania: 'tz', Vanuatu: 'vu', Fiji: 'fj', Cambodia: 'kh', Myanmar: 'mm', Vietnam: 'vn', Maldives: 'mv',
  Kyrgyzstan: 'kg', 'Papua New Guinea': 'pg', Macao: 'mo', Gibraltar: 'gi', 'New Caledonia': 'nc', Somalia: 'so', 'Korea, North': 'kp', Monaco: 'mc',
  Bonaire: 'bq', Bahrain: 'bh', 'Puerto Rico': 'pr', 'Sint Maarten': 'sx', 'Timor-Leste': 'tl', 'Southern Sudan': 'ss', Yemen: 'ye', Mongolia: 'mn',
  'St. Vincent & Grenadinen': 'vc', Botswana: 'bw', Sudan: 'sd',
};

/** URL til flaget for et land (databasens navn) – eller null, hvis landet ikke kendes */
export function flagUrl(name: string | undefined): string | null {
  const iso = name ? ISO[name] : undefined;
  return iso ? `https://flagcdn.com/${iso}.svg` : null;
}
