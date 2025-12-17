/**
 * 사진 업로드 자동화 스크립트
 * 
 * photos/cities/{도시}/ 폴더의 사진을 읽어:
 * 1. EXIF 메타데이터 추출 (촬영 날짜, GPS 위치)
 * 2. Cloudinary에 업로드
 * 3. cityPhotos.json 업데이트
 * 
 * 사용법: node scripts/upload-photos.js
 */

import { v2 as cloudinary } from 'cloudinary';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExifParser from 'exif-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
config();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const PHOTOS_DIR = path.join(__dirname, '../photos/cities');

// 영문 폴더명 -> 한글 도시명 매핑 (전체 여정)
const folderToKorean = {
  'gwangju': '광주',
  'incheon': '인천',
  'hochiminh': '호치민',
  'danang': '다낭',
  'kualalumpur': '쿠알라룸푸르',
  'medan': '메단',
  'tuktuk': '뚝뚝섬',
  'siemreap': '시엠립',
  'bangkok': '방콕',
  'vangvieng': '방비엥',
  'luangprabang': '루앙프라방',
  'vientiane': '비엔티안',
  'udonthani': '우돈타니',
  'chennai': '첸나이',
  'pondicherry': '퐁디셰리',
  'bangalore': '벵갈루루',
  'hampi': '함피',
  'hyderabad': '하이데라바드',
  'pune': '푸네',
  'mumbai': '뭄바이',
  'aurangabad': '아우랑가바드',
  'ajanta': '아잔타',
  'nagpur': '나그푸르',
  'jabalpur': '자발푸르',
  'kolkata': '콜카타',
  'varanasi': '바라나시',
  'prayagraj': '프라야그라지',
  'gorakhpur': '고라크푸르',
  'siddharthanagar': '싯다르타나가르',
  'sonauli': '소놀리',
  'pokhara': '포카라',
  'annapurna': '안나푸르나',
  'kathmandu': '카트만두',
  'bhaktapur': '박타푸르',
  'lucknow': '러크나우',
  'agra': '아그라',
  'newdelhi': '뉴델리',
  'tokyo': '도쿄',
  'abudhabi': '아부다비',
  'dubai': '두바이',
  'sharjah': '샤르자',
  'cairo': '카이로',
  'dahab': '다합',
  'barcelona': '바르셀로나',
  'sitges': '시체스',
  'milan': '밀라노',
  'turin': '토리노',
  'bra': '브라',
  'genoa': '제노바',
  'portofino': '포르토피노',
  'laspezia': '라스페치아',
  'pisa': '피사',
  'florence': '피렌체',
  'cinqueterre': '친퀘테레',
  'ortalake': '오르타 호수',
  'sofia': '소피아',
  'belgrade': '베오그라드',
  'budapest': '부다페스트',
  'prague': '프라하',
  'krakow': '크라쿠프',
  'brussels': '브뤼셀',
  'paris': '파리',
  'madrid': '마드리드',
  'porto': '포르투',
  'marrakech': '마라케쉬',
  'casablanca': '카사블랑카',
  'lisbon': '리스본',
  'rio': '리우데자네이루',
  'angradosreis': '앙그라 도스 헤이스',
  'ilhagrande': '이야 그란지',
  'paraty': '파라치',
  'itaguai': '이타과이',
  'caraguatatuba': '카라과타투바',
  'saosebastiao': '사웅 세바스치앙',
  'santos': '산투스',
  'saopaulo': '상파울루',
  'curitiba': '쿠리치바',
  'navegantes': '나베간치스',
  'bombinhas': '봄비냐스',
  'saojose': '상주제',
  'florianopolis': '플로리아노폴리스',
  'guardadoembau': '과르다 두 엠바우',
  'garopaba': '가로파바',
  'imbituba': '임비투바',
  'iguazu': '이과수',
  'posadas': '포사다스',
  'montevideo': '몬테비데오',
  'buenosaires': '부에노스아이레스',
  'santiago': '산티아고',
  'valparaiso': '발파라이소',
  'bahiainglesa': '바히아 잉글레사',
  'sanpedrodeatacama': '산 페드로 데 아타카마',
  'lagunaverde': '라구나 베르데',
  'desiertodalil': '살바도르 달리 사막',
  'uyuni': '우유니',
  'potosi': '포토시',
  'sucre': '수크레',
  'elalto': '엘알토',
  'copacabana_bolivia': '코파카바나',
  'puno': '푸노',
  'juliaca': '줄리아카',
  'machupicchu': '마추픽추',
  'lima': '리마',
  'piura': '피우라',
  'border': '국경',
  'cajas': '카하스 국립공원',
  'cuenca': '쿠엔카',
  'banos': '바뇨스',
  'pujili': '푸힐리',
  'quito': '키토',
  'tulcan': '툴칸',
  'ipiales': '이피알레스',
  'pasto': '파스토',
  'cali': '칼리',
  'bogota': '보고타',
  'medellin': '메데진',
  'cartagena': '카르타헤나',
  'barranquilla': '바랑키야'
};

// EXIF 메타데이터 추출
function extractExif(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const parser = ExifParser.create(buffer);
    const result = parser.parse();
    
    const tags = result.tags;
    
    // 날짜+시간 추출
    let date = null;
    if (tags.DateTimeOriginal) {
      const d = new Date(tags.DateTimeOriginal * 1000);
      // ISO 형식: YYYY-MM-DDTHH:mm:ss
      date = d.toISOString().slice(0, 19);
    }
    
    // GPS 위치 추출
    let gps = null;
    if (tags.GPSLatitude && tags.GPSLongitude) {
      gps = {
        lat: tags.GPSLatitude,
        lng: tags.GPSLongitude
      };
    }
    
    return { date, gps };
  } catch (error) {
    console.log(`  ⚠️  EXIF 읽기 실패: ${path.basename(filePath)}`);
    return { date: null, gps: null };
  }
}

// GPS 좌표 → 주소 변환 (도로명/구/시/도)
async function getAddressFromGPS(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
  
  try {
    const response = await fetch(url, {
      headers: { 
        'User-Agent': 'worldtrip-upload-script/1.0'
      }
    });
    
    if (!response.ok) return null;
    
    const data = await response.json();
    const addr = data.address;
    
    // 도로명, 구/시/도 추출
    const road = addr.road || addr.street || '';
    const district = addr.suburb || addr.district || addr.neighbourhood || '';
    const city = addr.city || addr.town || addr.village || '';
    const state = addr.state || addr.province || '';
    
    // 조합: "도로명, 구, 시" (빈값 제외)
    const parts = [road, district, city, state].filter(Boolean);
    return parts.join(', ');
  } catch (error) {
    console.log(`  ⚠️  주소 변환 실패: ${error.message}`);
    return null;
  }
}

// 사진 업로드
async function uploadPhoto(filePath, cityCode, index) {
  const filename = path.basename(filePath, path.extname(filePath));
  const originalFilename = path.basename(filePath); // 확장자 포함
  const folder = `cities/${cityCode}`;
  const photoName = `photo${String(index).padStart(3, '0')}`;
  const publicId = `${folder}/${photoName}`;
  
  // EXIF 추출
  const exif = extractExif(filePath);
  
  // GPS가 있으면 주소 변환 (도로명/구/시/도)
  let address = null;
  if (exif.gps) {
    address = await getAddressFromGPS(exif.gps.lat, exif.gps.lng);
    // API rate limit (1 req/sec)
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  try {
    // Build context string with all metadata INCLUDING original filename
    const contextParts = [];
    contextParts.push(`filename=${originalFilename}`); // 원본 파일명 저장
    if (exif.date) contextParts.push(`date=${exif.date}`);
    if (exif.gps) {
      contextParts.push(`lat=${exif.gps.lat}`);
      contextParts.push(`lng=${exif.gps.lng}`);
    }
    if (address) contextParts.push(`address=${address}`); // 주소 저장
    
    // Cloudinary에 업로드 (asset_folder로 Folders UI에 표시)
    const result = await cloudinary.uploader.upload(filePath, {
      public_id: photoName,
      folder: folder,
      asset_folder: folder,
      overwrite: true,
      context: contextParts.length > 0 ? contextParts.join('|') : undefined,
    });
    
    return {
      id: `${cityCode}-${String(index).padStart(3, '0')}`,
      publicId: publicId,
      url: `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_auto,q_auto/${publicId}`,
      thumbnail: `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_auto,q_auto,w_200,h_200,c_fill/${publicId}`,
      date: exif.date || '',
      gps: exif.gps,
      caption: {
        ko: '', // 빈값으로 설정 (캡션 없음)
        en: ''
      },
      originalFilename: originalFilename // 추적용
    };
  } catch (error) {
    console.error(`  ❌ 업로드 실패: ${filename}`, error.message);
    return null;
  }
}

async function main() {
  console.log('📷 사진 업로드 자동화 시작...\n');
  
  // photos/cities 폴더가 없으면 안내
  if (!fs.existsSync(PHOTOS_DIR)) {
    console.log('❌ photos/cities 폴더가 없습니다.');
    console.log('   먼저 다음 명령으로 폴더 구조를 생성하세요:');
    console.log('   node scripts/create-photo-folders.js\n');
    return;
  }
  
  const cityPhotos = {};
  let totalUploaded = 0;
  
  // 각 도시 폴더 순회
  const cityFolders = fs.readdirSync(PHOTOS_DIR).filter(f => {
    const fullPath = path.join(PHOTOS_DIR, f);
    return fs.statSync(fullPath).isDirectory();
  });
  
  for (const cityCode of cityFolders) {
    const cityPath = path.join(PHOTOS_DIR, cityCode);
    const koreanName = folderToKorean[cityCode];
    
    if (!koreanName) {
      console.log(`⚠️  ${cityCode} - 한글 매핑 없음, 건너뜀`);
      continue;
    }
    
    // 이미지 파일 찾기 (.gitkeep 제외)
    const imageFiles = fs.readdirSync(cityPath).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.jpg', '.jpeg', '.png', '.heic', '.webp'].includes(ext);
    });
    
    if (imageFiles.length === 0) {
      continue; // 사진 없는 폴더는 건너뜀
    }
    
    // Cloudinary에서 이미 업로드된 사진의 원본 파일명 확인
    let existingFilenames = [];
    let existingCount = 0;
    try {
      const resources = await cloudinary.api.resources({
        type: 'upload',
        prefix: `cities/${cityCode}/`,
        max_results: 500,
        resource_type: 'image',
        context: true // context 메타데이터 포함
      });
      
      existingCount = resources.resources.length;
      
      // context에서 원본 파일명 추출
      existingFilenames = resources.resources
        .map(r => {
          if (r.context && r.context.custom) {
            const filenameMatch = r.context.custom.filename;
            return filenameMatch || null;
          }
          return null;
        })
        .filter(Boolean);
        
      console.log(`  📦 기존 사진: ${existingCount}장`);
    } catch (e) {
      // 폴더가 없으면 빈 배열
    }
    
    console.log(`📸 ${koreanName} (${cityCode}): ${imageFiles.length}장`);
    
    const photos = [];
    let skipped = 0;
    
    for (let i = 0; i < imageFiles.length; i++) {
      const currentFilename = imageFiles[i];
      
      // 파일명으로 중복 체크
      if (existingFilenames.includes(currentFilename)) {
        console.log(`  ⏭️  ${currentFilename} - 이미 업로드됨`);
        skipped++;
        continue;
      }
      
      const imagePath = path.join(cityPath, currentFilename);
      // 기존 개수 + 새로 추가되는 순서로 번호 부여
      const result = await uploadPhoto(imagePath, cityCode, existingCount + photos.length + 1);
      
      if (result) {
        photos.push(result);
        const gpsInfo = result.gps ? ` 📍 ${result.gps.lat.toFixed(4)}, ${result.gps.lng.toFixed(4)}` : '';
        const dateInfo = result.date ? ` 📅 ${result.date}` : '';
        console.log(`  ✅ ${currentFilename}${dateInfo}${gpsInfo}`);
        totalUploaded++;
      }
    }
    
    if (skipped > 0) {
      console.log(`  📊 스킵: ${skipped}장, 업로드: ${photos.length}장`);
    }
    
    totalUploaded += photos.length;
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`✨ 완료!`);
  console.log(`   업로드: ${totalUploaded}장`);
  console.log(`\n💡 TIP: cityPhotos.json을 업데이트하려면 'npm run sync-photos'를 실행하세요.`);
}

main().catch(console.error);
