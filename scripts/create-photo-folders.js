/**
 * 로컬 사진 폴더 구조 생성 스크립트
 * 
 * photos/cities/{도시}/ 폴더를 생성하고 .gitkeep 파일 추가
 * 
 * 사용법: node scripts/create-photo-folders.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PHOTOS_DIR = path.join(__dirname, '../photos/cities');

// 모든 여행 도시 목록
const cities = [
  'gwangju', 'incheon', 'hochiminh', 'danang', 'kualalumpur', 'medan', 'tuktuk',
  'siemreap', 'bangkok', 'vangvieng', 'luangprabang', 'vientiane', 'udonthani', 'chennai',
  'pondicherry', 'bangalore', 'hampi', 'hyderabad', 'pune', 'mumbai', 'aurangabad',
  'ajanta', 'nagpur', 'jabalpur', 'kolkata', 'varanasi', 'sonauli', 'pokhara',
  'annapurna', 'kathmandu', 'lucknow', 'agra', 'newdelhi', 'tokyo', 'abudhabi',
  'dubai', 'cairo', 'dahab', 'barcelona', 'milan', 'turin', 'bra', 'genoa',
  'portofino', 'laspezia', 'pisa', 'florence', 'cinqueterre', 'ortalake', 'sofia',
  'belgrade', 'budapest', 'katowice', 'warsaw', 'prague', 'brussels', 'paris',
  'madrid', 'porto', 'marrakech', 'casablanca', 'lisbon', 'rio', 'angradosreis',
  'ilhagrande', 'paraty', 'itaguai', 'caraguatatuba', 'saosebastiao', 'santos',
  'saopaulo', 'curitiba', 'navegantes', 'bombinhas', 'saojose', 'florianopolis',
  'guardadoembau', 'garopaba', 'imbituba', 'iguazu', 'posadas', 'montevideo',
  'buenosaires', 'santiago', 'valparaiso', 'bahiainglesa', 'sanpedrodeatacama',
  'lagunaverde', 'desiertodalil', 'uyuni', 'potosi', 'sucre', 'elalto',
  'copacabana_bolivia', 'puno', 'juliaca', 'machupicchu', 'lima', 'piura',
  'border', 'cajas', 'cuenca', 'banos', 'pujili', 'quito', 'tulcan', 'ipiales',
  'pasto', 'cali', 'bogota', 'medellin', 'cartagena', 'barranquilla'
];

function createFolders() {
  console.log('📁 로컬 사진 폴더 구조 생성 시작...\n');
  
  // photos/cities 기본 폴더 생성
  if (!fs.existsSync(PHOTOS_DIR)) {
    fs.mkdirSync(PHOTOS_DIR, { recursive: true });
    console.log(`📂 photos/cities 폴더 생성됨\n`);
  }
  
  let created = 0;
  let existing = 0;
  
  for (const city of cities) {
    const cityPath = path.join(PHOTOS_DIR, city);
    const gitkeepPath = path.join(cityPath, '.gitkeep');
    
    if (!fs.existsSync(cityPath)) {
      fs.mkdirSync(cityPath, { recursive: true });
      fs.writeFileSync(gitkeepPath, '');
      console.log(`📁 ${city}/ - 생성됨`);
      created++;
    } else if (!fs.existsSync(gitkeepPath)) {
      fs.writeFileSync(gitkeepPath, '');
      console.log(`✅ ${city}/ - .gitkeep 추가됨`);
      existing++;
    } else {
      existing++;
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`✨ 완료!`);
  console.log(`   생성: ${created}개`);
  console.log(`   기존: ${existing}개`);
  console.log(`\n💡 사용법:`);
  console.log(`   1. photos/cities/{도시}/ 폴더에 사진 추가`);
  console.log(`   2. npm run upload-photos 실행`);
}

createFolders();
