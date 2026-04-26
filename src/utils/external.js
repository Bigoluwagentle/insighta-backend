const https = require("https");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error("Failed to parse response")); }
      });
    }).on("error", reject);
  });
}

async function fetchGenderize(name) {
  const data = await fetchJson(`https://api.genderize.io?name=${encodeURIComponent(name)}`);
  if (!data.gender || data.count === 0) {
    const err = new Error("Genderize returned an invalid response");
    err.status = 502; err.api = "Genderize"; throw err;
  }
  return { gender: data.gender, gender_probability: data.probability, sample_size: data.count };
}

async function fetchAgify(name) {
  const data = await fetchJson(`https://api.agify.io?name=${encodeURIComponent(name)}`);
  if (data.age === null || data.age === undefined) {
    const err = new Error("Agify returned an invalid response");
    err.status = 502; err.api = "Agify"; throw err;
  }
  return { age: data.age };
}

async function fetchNationalize(name) {
  const data = await fetchJson(`https://api.nationalize.io?name=${encodeURIComponent(name)}`);
  if (!data.country || data.country.length === 0) {
    const err = new Error("Nationalize returned an invalid response");
    err.status = 502; err.api = "Nationalize"; throw err;
  }
  const top = data.country.reduce((a, b) => (a.probability >= b.probability ? a : b));
  return { country_id: top.country_id, country_probability: top.probability };
}

function getAgeGroup(age) {
  if (age <= 12) return "child";
  if (age <= 19) return "teenager";
  if (age <= 59) return "adult";
  return "senior";
}

async function buildProfile(name) {
  const [genderData, ageData, nationalityData] = await Promise.all([
    fetchGenderize(name), fetchAgify(name), fetchNationalize(name),
  ]);
  return {
    ...genderData, ...ageData,
    age_group: getAgeGroup(ageData.age),
    ...nationalityData,
  };
}

module.exports = { buildProfile };