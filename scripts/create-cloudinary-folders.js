/**
 * Cloudinary 도시 폴더 생성 스크립트 (create_folder API 사용)
 * 
 * 사용법: node scripts/create-cloudinary-folders.js
 */

import { v2 as cloudinary } from 'cloudinary';
import { config } from 'dotenv';

// Load .env
config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 한글 도시명 -> 영문 폴더명 매핑
const cityToFolder = {
  '광주': 'gwangju',
  '인천': 'incheon',
  '호치민': 'hochiminh',
  '다낭': 'danang',
  '쿠알라룸푸르': 'kualalumpur',
  '메단': 'medan',
  '뚝뚝섬': 'tuktuk',
  '방콕': 'bangkok',
  '방비엥': 'vangvieng',
  '루앙프라방': 'luangprabang',
  '비엔티안': 'vientiane',
  '우돈타니': 'udonthani',
  '첸나이': 'chennai',
  '퐁디셰리': 'pondicherry',
  '벵갈루루': 'bangalore',
  '함피': 'hampi',
  '하이데라바드': 'hyderabad',
  '푸네': 'pune',
  '뭄바이': 'mumbai',
  '아우랑가바드': 'aurangabad',
  '아잔타': 'ajanta',
  '나그푸르': 'nagpur',
  '자발푸르': 'jabalpur',
  '콜카타': 'kolkata',
  '바라나시': 'varanasi',
  '소놀리': 'sonauli',
  '포카라': 'pokhara',
  '안나푸르나': 'annapurna',
  '카트만두': 'kathmandu',
  '러크나우': 'lucknow',
  '아그라': 'agra',
  '뉴델리': 'newdelhi',
  '도쿄': 'tokyo',
  '아부다비': 'abudhabi',
  '두바이': 'dubai',
  '카이로': 'cairo',
  '다합': 'dahab',
  '바르셀로나': 'barcelona',
  '밀라노': 'milan',
  '토리노': 'turin',
  '브라': 'bra',
  '제노바': 'genoa',
  '포르토피노': 'portofino',
  '라스페치아': 'laspezia',
  '피사': 'pisa',
  '피렌체': 'florence',
  '친퀘테레': 'cinqueterre',
  '오르타 호수': 'ortalake',
  '소피아': 'sofia',
  '베오그라드': 'belgrade',
  '부다페스트': 'budapest',
  '카토비세': 'katowice',
  '바르샤바': 'warsaw',
  '프라하': 'prague',
  '브뤼셀': 'brussels',
  '파리': 'paris',
  '마드리드': 'madrid',
  '포르투': 'porto',
  '마라케쉬': 'marrakech',
  '카사블랑카': 'casablanca',
  '리스본': 'lisbon',
  '리우데자네이루': 'rio',
  '앙그라도스헤이스': 'angradosreis',
  '일랴 그란지 섬': 'ilhagrande',
  '파라티': 'paraty',
  '이타구아': 'itaguai',
  '카라구아타투바': 'caraguatatuba',
  '사웅 세바스치앙': 'saosebastiao',
  '산토스': 'santos',
  '상파울로': 'saopaulo',
  '쿠리치바': 'curitiba',
  '나베간치스': 'navegantes',
  '봄비냐스': 'bombinhas',
  '상조제': 'saojose',
  '플로리아노폴리스': 'florianopolis',
  '과르다 두 엠바우': 'guardadoembau',
  '가로파바': 'garopaba',
  '임비투바': 'imbituba',
  '이과수 폭포': 'iguazu',
  '포사다스': 'posadas',
  '몬테비데오': 'montevideo',
  '부에노스아이레스': 'buenosaires',
  '산티아고': 'santiago',
  '발파라이소': 'valparaiso',
  '바히아 잉글레사': 'bahiainglesa',
  '산 페드로 데 아타카마': 'sanpedrodeatacama',
  '라구나 베르데': 'lagunaverde',
  '살바도르 달리 사막': 'desiertodalil',
  '우유니': 'uyuni',
  '포토시': 'potosi',
  '수크레': 'sucre',
  '엘알토': 'elalto',
  '코파카바나': 'copacabana_bolivia',
  '푸노': 'puno',
  '줄리아카': 'juliaca',
  '마추픽추': 'machupicchu',
  '리마': 'lima',
  '피우라': 'piura',
  '국경': 'border',
  '카하스 국립공원': 'cajas',
  '쿠엔카': 'cuenca',
  '바뇨스': 'banos',
  '푸힐리': 'pujili',
  '키토': 'quito',
  '툴칸': 'tulcan',
  '이피알레스': 'ipiales',
  '파스토': 'pasto',
  '칼리': 'cali',
  '보고타': 'bogota',
  '메데진': 'medellin',
  '카르타헤나': 'cartagena',
  '바랑키야': 'barranquilla'
};

async function createFolders() {
  console.log('🚀 Cloudinary 도시 폴더 생성 시작 (create_folder API)...\n');
  console.log(`총 ${Object.keys(cityToFolder).length}개 도시\n`);
  
  let created = 0;
  let existing = 0;
  let errors = 0;
  
  for (const [korean, folder] of Object.entries(cityToFolder)) {
    const folderPath = `cities/${folder}`;
    
    try {
      const result = await cloudinary.api.create_folder(folderPath);
      if (result.success) {
        console.log(`📁 ${folderPath} (${korean}) - 생성됨`);
        created++;
      }
    } catch (error) {
      if (error.error && error.error.message && error.error.message.includes('already exists')) {
        console.log(`✅ ${folderPath} (${korean}) - 이미 존재`);
        existing++;
      } else {
        console.error(`❌ ${folderPath} (${korean}) - 오류:`, error.message || error);
        errors++;
      }
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`✨ 완료!`);
  console.log(`   생성: ${created}개`);
  console.log(`   기존: ${existing}개`);
  console.log(`   오류: ${errors}개`);
}

createFolders().catch(console.error);
