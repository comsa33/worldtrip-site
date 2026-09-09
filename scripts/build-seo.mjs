// journey.json / countries.json → public/llms.txt + index.html 의 GEO 블록(JSON-LD, noscript)
// 실행: node scripts/build-seo.mjs
import fs from 'node:fs';

const SITE = 'https://backpacking.po24lio.com';
const j = JSON.parse(fs.readFileSync('src/data/journey.json', 'utf8'));
const countries = JSON.parse(fs.readFileSync('src/data/countries.json', 'utf8')).countries;
const byCode = Object.fromEntries(countries.map((c) => [c.code, c]));

// 국가 방문 순서(중복 제거), 국가별 도시
const order = [];
const citiesOf = {};
for (const s of j.stops) {
  if (!order.includes(s.countryCode)) order.push(s.countryCode);
  const list = (citiesOf[s.countryCode] ??= []);
  if (!list.includes(s.city)) list.push(s.city);
}
const stat = `${j.totalDays}일, ${j.totalCountries}개국, ${j.stops.length}개 stop`;

// ---- llms.txt
const llms = `# 세계일주 배낭여행 2016-2017 (World Trip)

> 이루오(Ruo Lee)가 ${j.startDate}부터 ${j.endDate}까지 ${stat}을 거친 세계일주 배낭여행 기록. 3D 지구본 위에 실제 경로와 GPS 사진을 표시하는 인터랙티브 사이트. 한국어/영어.

- 사이트: ${SITE}/
- 특정 도시로 바로 가기: ${SITE}/?stop=<id> (id 1~${j.stops.length})
- 작성자 포트폴리오: https://po24lio.com , 블로그: https://blog.po24lio.com
- 사진: 각 도시 필름스트립 (Cloudinary). 육로 구간은 OSRM 실제 도로 경로.

## 여정 (국가 순서)

${order.map((c, i) => `${i + 1}. ${byCode[c].name.ko} (${byCode[c].name.en}, ${c}) — ${citiesOf[c].join(', ')}`).join('\n')}

## 전체 stop 목록

${j.stops.map((s) => `- #${s.id} ${s.city} (${byCode[s.countryCode].name.en}) ${s.startDate}~${s.endDate}${s.note ? ` · ${s.note}` : ''}`).join('\n')}
`;
fs.writeFileSync('public/llms.txt', llms);

// ---- JSON-LD TouristTrip
const trip = {
  '@context': 'https://schema.org',
  '@type': 'TouristTrip',
  name: '세계일주 배낭여행 2016-2017',
  alternateName: 'Round-the-world backpacking trip 2016-2017',
  description: `${j.startDate}부터 ${j.endDate}까지 ${stat}을 거친 세계일주 배낭여행`,
  url: `${SITE}/`,
  touristType: 'backpacker',
  itinerary: {
    '@type': 'ItemList',
    numberOfItems: order.length,
    itemListElement: order.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Country',
        name: byCode[c].name.en,
        alternateName: byCode[c].name.ko,
        geo: {
          '@type': 'GeoCoordinates',
          latitude: byCode[c].coordinates.lat,
          longitude: byCode[c].coordinates.lng,
        },
      },
    })),
  },
  subjectOf: { '@type': 'WebSite', url: `${SITE}/` },
};

// ---- noscript 요약 (캔버스를 못 읽는 크롤러·LLM용)
const noscript = `      <main>
        <h1>세계일주 배낭여행 2016-2017</h1>
        <p>${j.startDate}부터 ${j.endDate}까지 ${stat}. 3D 지구본 위에 경로와 사진을 표시하는 사이트입니다. JavaScript를 켜면 지구본이 보입니다.</p>
        <ol>
${order.map((c) => `          <li><a href="/?stop=${j.stops.find((s) => s.countryCode === c).id}">${byCode[c].name.ko} (${byCode[c].name.en})</a>: ${citiesOf[c].join(', ')}</li>`).join('\n')}
        </ol>
        <p><a href="/llms.txt">텍스트 요약 (llms.txt)</a> · <a href="https://po24lio.com">이루오 포트폴리오</a> · <a href="https://blog.po24lio.com">블로그</a></p>
      </main>`;

let html = fs.readFileSync('index.html', 'utf8');
const put = (tag, body) => {
  const re = new RegExp(`(<!-- geo:${tag} -->)[\\s\\S]*?(<!-- /geo:${tag} -->)`);
  if (!re.test(html)) throw new Error(`marker geo:${tag} not found`);
  html = html.replace(re, `$1\n${body}\n    $2`);
};
put('jsonld', `    <script type="application/ld+json">\n${JSON.stringify(trip)}\n    </script>`);
put('noscript', `    <noscript>\n${noscript}\n    </noscript>`);
fs.writeFileSync('index.html', html);
console.log(`llms.txt ${llms.length}B, ${order.length} countries, ${j.stops.length} stops`);
