// Landenavne: databasen har engelske navne (enkelte på tysk). Her oversættes de til dansk
// og rettes til almindeligt engelsk. Ukendte navne vises uændret.

const DA: Record<string, string> = {
  France: 'Frankrig', Brazil: 'Brasilien', Italy: 'Italien', Colombia: 'Colombia', Sweden: 'Sverige', Norway: 'Norge',
  Japan: 'Japan', Argentina: 'Argentina', 'Türkiye': 'Tyrkiet', Turkey: 'Tyrkiet', Spain: 'Spanien', 'United States': 'USA',
  Denmark: 'Danmark', Ukraine: 'Ukraine', Portugal: 'Portugal', Russia: 'Rusland', Netherlands: 'Holland', Greece: 'Grækenland',
  Belgium: 'Belgien', England: 'England', 'Saudi Arabia': 'Saudi-Arabien', Croatia: 'Kroatien', Mexico: 'Mexico',
  Australia: 'Australien', Scotland: 'Skotland', Austria: 'Østrig', 'Czech Republic': 'Tjekkiet', Germany: 'Tyskland',
  Serbia: 'Serbien', Poland: 'Polen', 'Korea, South': 'Sydkorea', Switzerland: 'Schweiz', Romania: 'Rumænien',
  Bulgaria: 'Bulgarien', Paraguay: 'Paraguay', Hungary: 'Ungarn', Georgia: 'Georgien', 'North Macedonia': 'Nordmakedonien',
  Peru: 'Peru', Belarus: 'Hviderusland', Canada: 'Canada', "Cote d'Ivoire": 'Elfenbenskysten', Morocco: 'Marokko',
  Montenegro: 'Montenegro', 'Bosnia-Herzegovina': 'Bosnien-Hercegovina', Cameroon: 'Cameroun', Angola: 'Angola',
  Tunisia: 'Tunesien', Ireland: 'Irland', Iceland: 'Island', 'DR Congo': 'DR Congo', Nigeria: 'Nigeria', Wales: 'Wales',
  Chile: 'Chile', Israel: 'Israel', Slovakia: 'Slovakiet', 'Northern Ireland': 'Nordirland', Grenada: 'Grenada',
  Finland: 'Finland', Senegal: 'Senegal', Guinea: 'Guinea', Tahiti: 'Tahiti', Unknown: 'Ukendt', 'South Africa': 'Sydafrika',
  Ghana: 'Ghana', Moldova: 'Moldova', Mali: 'Mali', 'Saint-Martin': 'Saint-Martin', Martinique: 'Martinique', Algeria: 'Algeriet',
  'French Guiana': 'Fransk Guyana', 'Réunion': 'Réunion', Uruguay: 'Uruguay', Lithuania: 'Litauen', Albania: 'Albanien',
  Eritrea: 'Eritrea', Egypt: 'Egypten', 'Cape Verde': 'Kap Verde', 'Equatorial Guinea': 'Ækvatorialguinea', Togo: 'Togo',
  Uzbekistan: 'Usbekistan', Jamaica: 'Jamaica', 'Trinidad and Tobago': 'Trinidad og Tobago', Guadeloupe: 'Guadeloupe',
  Qatar: 'Qatar', Rwanda: 'Rwanda', Iran: 'Iran', 'Antigua and Barbuda': 'Antigua og Barbuda', 'The Gambia': 'Gambia',
  Slovenia: 'Slovenien', Latvia: 'Letland', 'Burkina Faso': 'Burkina Faso', Armenia: 'Armenien', Estonia: 'Estland',
  Mozambique: 'Mozambique', Burundi: 'Burundi', 'Chinese Taipei': 'Taiwan', Barbados: 'Barbados', Syria: 'Syrien',
  Philippines: 'Filippinerne', Gabon: 'Gabon', 'Sierra Leone': 'Sierra Leone', Curacao: 'Curaçao', Pakistan: 'Pakistan',
  'Faroe Islands': 'Færøerne', Madagascar: 'Madagaskar', Zambia: 'Zambia', Kazakhstan: 'Kasakhstan', Venezuela: 'Venezuela',
  Oman: 'Oman', Cyprus: 'Cypern', Azerbaijan: 'Aserbajdsjan', Kosovo: 'Kosovo', 'New Zealand': 'New Zealand',
  'Guinea-Bissau': 'Guinea-Bissau', Congo: 'Congo', 'Central African Republic': 'Den Centralafrikanske Republik',
  Ecuador: 'Ecuador', Haiti: 'Haiti', Benin: 'Benin', 'Costa Rica': 'Costa Rica', Kenya: 'Kenya', Suriname: 'Surinam',
  Luxembourg: 'Luxembourg', Ethiopia: 'Etiopien', Seychelles: 'Seychellerne', 'Dominican Republic': 'Den Dominikanske Republik',
  'El Salvador': 'El Salvador', Zimbabwe: 'Zimbabwe', Andorra: 'Andorra', Malta: 'Malta', Honduras: 'Honduras', Uganda: 'Uganda',
  Comoros: 'Comorerne', Guyana: 'Guyana', Malaysia: 'Malaysia', Palestine: 'Palæstina', Aruba: 'Aruba', 'San Marino': 'San Marino',
  Malawi: 'Malawi', Iraq: 'Irak', India: 'Indien', Tajikistan: 'Tadsjikistan', Thailand: 'Thailand', 'Brunei Darussalam': 'Brunei',
  Liechtenstein: 'Liechtenstein', Mauritania: 'Mauretanien', Niger: 'Niger', Singapore: 'Singapore', Bhutan: 'Bhutan',
  Guatemala: 'Guatemala', Bolivia: 'Bolivia', Liberia: 'Liberia', Panama: 'Panama', Lebanon: 'Libanon', Chad: 'Tchad',
  Indonesia: 'Indonesien', Libya: 'Libyen', Bangladesh: 'Bangladesh', 'Sao Tome and Principe': 'São Tomé og Príncipe',
  Montserrat: 'Montserrat', Turkmenistan: 'Turkmenistan', 'United Arab Emirates': 'De Forenede Arabiske Emirater', Cuba: 'Cuba',
  'St. Kitts & Nevis': 'Saint Kitts og Nevis', Nicaragua: 'Nicaragua', 'Sri Lanka': 'Sri Lanka', China: 'Kina', Laos: 'Laos',
  Mauritius: 'Mauritius', Hongkong: 'Hongkong', Neukaledonien: 'Ny Kaledonien', 'St. Lucia': 'Saint Lucia',
  Afghanistan: 'Afghanistan', Jordan: 'Jordan', Bermuda: 'Bermuda', Belize: 'Belize', Tanzania: 'Tanzania', Vanuatu: 'Vanuatu',
  Fiji: 'Fiji', Cambodia: 'Cambodja', Myanmar: 'Myanmar', Vietnam: 'Vietnam', Maldives: 'Maldiverne', Kyrgyzstan: 'Kirgisistan',
  'Papua New Guinea': 'Papua Ny Guinea', Macao: 'Macao', Gibraltar: 'Gibraltar', 'New Caledonia': 'Ny Kaledonien',
  Somalia: 'Somalia', 'Korea, North': 'Nordkorea', Monaco: 'Monaco', Bonaire: 'Bonaire', Bahrain: 'Bahrain',
  'Puerto Rico': 'Puerto Rico', 'Sint Maarten': 'Sint Maarten', 'Timor-Leste': 'Østtimor', 'Southern Sudan': 'Sydsudan',
  Yemen: 'Yemen', Mongolia: 'Mongoliet', 'St. Vincent & Grenadinen': 'Saint Vincent og Grenadinerne', Botswana: 'Botswana',
  Sudan: 'Sudan',
};

const EN: Record<string, string> = {
  'Türkiye': 'Turkey', 'Korea, South': 'South Korea', 'Korea, North': 'North Korea', "Cote d'Ivoire": 'Ivory Coast',
  Hongkong: 'Hong Kong', Neukaledonien: 'New Caledonia', 'St. Vincent & Grenadinen': 'St. Vincent & the Grenadines',
  'Brunei Darussalam': 'Brunei', Curacao: 'Curaçao', 'Southern Sudan': 'South Sudan', 'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
};

const TR: Record<string, string> = {
  England: 'İngiltere', Scotland: 'İskoçya', Wales: 'Galler', 'Northern Ireland': 'Kuzey İrlanda',
  Spain: 'İspanya', France: 'Fransa', Germany: 'Almanya', Italy: 'İtalya', Portugal: 'Portekiz',
  Netherlands: 'Hollanda', Belgium: 'Belçika', Türkiye: 'Türkiye', Turkey: 'Türkiye', Denmark: 'Danimarka',
  Sweden: 'İsveç', Norway: 'Norveç', Finland: 'Finlandiya', Ireland: 'İrlanda', Greece: 'Yunanistan',
  Switzerland: 'İsviçre', Austria: 'Avusturya', Poland: 'Polonya', Croatia: 'Hırvatistan', Serbia: 'Sırbistan',
  Ukraine: 'Ukrayna', Russia: 'Rusya', Brazil: 'Brezilya', Argentina: 'Arjantin', Mexico: 'Meksika',
  'United States': 'Amerika Birleşik Devletleri', 'South Korea': 'Güney Kore', 'Korea, South': 'Güney Kore',
  'North Korea': 'Kuzey Kore', 'Korea, North': 'Kuzey Kore', 'Ivory Coast': 'Fildişi Sahili',
  "Cote d'Ivoire": 'Fildişi Sahili', Japan: 'Japonya', China: 'Çin', Australia: 'Avustralya',
  'South Africa': 'Güney Afrika', Egypt: 'Mısır', Morocco: 'Fas', Algeria: 'Cezayir', Tunisia: 'Tunus',
  Nigeria: 'Nijerya', Cameroon: 'Kamerun', Senegal: 'Senegal', Ghana: 'Gana', Colombia: 'Kolombiya',
  Uruguay: 'Uruguay', Chile: 'Şili', Paraguay: 'Paraguay', Ecuador: 'Ekvador', Peru: 'Peru',
  'Saudi Arabia': 'Suudi Arabistan', Qatar: 'Katar', 'United Arab Emirates': 'Birleşik Arap Emirlikleri',
  'New Zealand': 'Yeni Zelanda', Canada: 'Kanada', Iceland: 'İzlanda', Israel: 'İsrail', India: 'Hindistan',
};

/** Landets navn på det valgte sprog (databasens navn ind, oversat navn ud) */
export function nationLabel(name: string | undefined, lang: Lang): string {
  if (!name) return '';
  return (lang === 'da' ? DA[name] : lang === 'tr' ? TR[name] : EN[name]) ?? name;
}
import type { Lang } from '../game/types';

