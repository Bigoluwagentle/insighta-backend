const COUNTRY_MAP = {
  nigeria: "NG", niger: "NE", ghana: "GH", kenya: "KE", tanzania: "TZ",
  uganda: "UG", ethiopia: "ET", egypt: "EG", angola: "AO", cameroon: "CM",
  senegal: "SN", mali: "ML", zambia: "ZM", zimbabwe: "ZW", mozambique: "MZ",
  madagascar: "MG", malawi: "MW", rwanda: "RW", burundi: "BI", somalia: "SO",
  sudan: "SD", chad: "TD", congo: "CG", drc: "CD", benin: "BJ", togo: "TG",
  "ivory coast": "CI", "burkina faso": "BF", guinea: "GN", gabon: "GA",
  namibia: "NA", botswana: "BW", lesotho: "LS", eswatini: "SZ", eritrea: "ER",
  djibouti: "DJ", mauritius: "MU", "sierra leone": "SL", liberia: "LR",
  gambia: "GM", libya: "LY", tunisia: "TN", algeria: "DZ", morocco: "MA",
  mauritania: "MR", usa: "US", "united states": "US", uk: "GB",
  "united kingdom": "GB", france: "FR", germany: "DE", china: "CN",
  india: "IN", brazil: "BR", indonesia: "ID", pakistan: "PK",
  bangladesh: "BD", russia: "RU", mexico: "MX", japan: "JP",
};

function parseQuery(q) {
  if (!q || q.trim() === "") return null;
  const text = q.toLowerCase().trim();
  const filters = {};

  if (/\bmales?\b/.test(text) && !/\bfemales?\b/.test(text)) filters.gender = "male";
  else if (/\bfemales?\b/.test(text) && !/\bmales?\b/.test(text)) filters.gender = "female";

  if (/\bchildren\b|\bchild\b|\bkids?\b/.test(text)) filters.age_group = "child";
  else if (/\bteenagers?\b|\bteens?\b/.test(text)) filters.age_group = "teenager";
  else if (/\badults?\b/.test(text)) filters.age_group = "adult";
  else if (/\bseniors?\b|\belderly\b/.test(text)) filters.age_group = "senior";

  if (/\byoung\b/.test(text) && !filters.age_group) {
    filters.min_age = 16; filters.max_age = 24;
  }

  const aboveMatch = text.match(/(?:above|over|older than)\s+(\d+)/);
  if (aboveMatch) filters.min_age = parseInt(aboveMatch[1]);

  const belowMatch = text.match(/(?:below|under|younger than)\s+(\d+)/);
  if (belowMatch) filters.max_age = parseInt(belowMatch[1]);

  const betweenMatch = text.match(/between\s+(\d+)\s+and\s+(\d+)/);
  if (betweenMatch) {
    filters.min_age = parseInt(betweenMatch[1]);
    filters.max_age = parseInt(betweenMatch[2]);
  }

  for (const [name, code] of Object.entries(COUNTRY_MAP)) {
    if (text.includes(name)) { filters.country_id = code; break; }
  }

  if (Object.keys(filters).length === 0) return null;
  return filters;
}

module.exports = { parseQuery };