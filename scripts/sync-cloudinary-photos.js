/**
 * Cloudinary 사진 동기화 스크립트
 * Cloudinary의 cities/ 폴더에서 사진을 가져와 cityPhotos.json 업데이트
 * 
 * 사용법: node scripts/sync-cloudinary-photos.js
 */

import { v2 as cloudinary } from 'cloudinary';
import { config } from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

// 영문 폴더명 -> 한글 도시명 매핑
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
  'sonauli': '소놀리',
  'pokhara': '포카라',
  'annapurna': '안나푸르나',
  'kathmandu': '카트만두',
  'lucknow': '러크나우',
  'agra': '아그라',
  'newdelhi': '뉴델리',
  'tokyo': '도쿄',
  'abudhabi': '아부다비',
  'dubai': '두바이',
  'cairo': '카이로',
  'dahab': '다합',
  'barcelona': '바르셀로나',
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
  'katowice': '카토비세',
  'warsaw': '바르샤바',
  'prague': '프라하',
  'brussels': '브뤼셀',
  'paris': '파리',
  'madrid': '마드리드',
  'porto': '포르투',
  'marrakech': '마라케쉬',
  'casablanca': '카사블랑카',
  'lisbon': '리스본',
  'rio': '리우데자네이루',
  'angradosreis': '앙그라도스헤이스',
  'ilhagrande': '일랴 그란지 섬',
  'paraty': '파라티',
  'itaguai': '이타구아',
  'caraguatatuba': '카라구아타투바',
  'saosebastiao': '사웅 세바스치앙',
  'santos': '산토스',
  'saopaulo': '상파울로',
  'curitiba': '쿠리치바',
  'navegantes': '나베간치스',
  'bombinhas': '봄비냐스',
  'saojose': '상조제',
  'florianopolis': '플로리아노폴리스',
  'guardadoembau': '과르다 두 엠바우',
  'garopaba': '가로파바',
  'imbituba': '임비투바',
  'iguazu': '이과수 폭포',
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

async function syncPhotos() {
  console.log('🚀 Cloudinary 사진 동기화 시작...\n');
  
  const cityPhotos = {};
  let totalPhotos = 0;
  
  // Get all folders
  const folders = await cloudinary.api.sub_folders('cities');
  console.log(`📁 ${folders.folders.length}개 도시 폴더 발견\n`);
  
  for (const folder of folders.folders) {
    const cityCode = folder.name;
    const koreanName = folderToKorean[cityCode];
    
    if (!koreanName) {
      console.log(`⚠️  ${cityCode} - 한글 매핑 없음, 건너뜀`);
      continue;
    }
    
    // Get photos from this folder with metadata (context, image_metadata for EXIF)
    const resources = await cloudinary.api.resources({
      type: 'upload',
      prefix: `cities/${cityCode}/`,
      max_results: 100,
      resource_type: 'image',
      context: true,           // Get user-defined context (title, description, etc.)
      image_metadata: true     // Get EXIF metadata
    });
    
    // Filter out placeholder files
    const photos = resources.resources.filter(r => !r.public_id.includes('.placeholder'));
    
    if (photos.length === 0) {
      continue; // Skip cities with no photos
    }
    
    console.log(`📸 ${koreanName} (${cityCode}): ${photos.length}장`);
    
    const photoData = [];
    
    for (let idx = 0; idx < photos.length; idx++) {
      const photo = photos[idx];
      const publicId = photo.public_id;
      const filename = publicId.split('/').pop();
      
      // Extract context metadata (user-defined in Cloudinary)
      const context = photo.context?.custom || {};
      const title = context.caption || context.alt || '';
      const description = context.description || '';
      
      // Extract date from context first, fallback to EXIF
      let date = context.date || '';
      if (!date && photo.image_metadata) {
        const exif = photo.image_metadata;
        const dateStr = exif.DateTimeOriginal || exif.DateTime || exif.DateTimeDigitized;
        if (dateStr) {
          date = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2}).*/, '$1-$2-$3');
        }
      }
      
      // Extract GPS from context first, fallback to EXIF
      let gps = null;
      let address = null;
      if (context.lat && context.lng) {
        gps = {
          lat: parseFloat(context.lat),
          lng: parseFloat(context.lng)
        };
        address = context.address || null; // 주소 정보
      } else if (photo.image_metadata) {
        const exif = photo.image_metadata;
        if (exif.GPSLatitude && exif.GPSLongitude) {
          try {
            gps = {
              lat: parseFloat(exif.GPSLatitude),
              lng: parseFloat(exif.GPSLongitude)
            };
          } catch (e) {
            // GPS parsing failed
          }
        }
      }
      
      // Generate optimized URL
      const url = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_auto,q_auto/${publicId}`;
      
      photoData.push({
        id: `${cityCode}-${String(idx + 1).padStart(3, '0')}`,
        publicId: publicId,
        url: url,
        thumbnail: `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_auto,q_auto,w_200,h_200,c_fill/${publicId}`,
        date: date,
        gps: gps,
        location: address, // 주소 추가
        caption: {
          ko: title || '',
          en: title || ''
        },
        alt: description || title || filename
      });
      
      // Log metadata info
      const dateInfo = date ? ` 📅 ${date}` : '';
      const locationInfo = address ? ` 📍 ${address}` : (gps ? ` 📍 ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : '');
      const titleInfo = title ? ` 💬 "${title}"` : '';
      console.log(`  ${filename}${dateInfo}${locationInfo}${titleInfo}`);
    }
    
    cityPhotos[koreanName] = {
      cityCode: cityCode,
      photos: photoData
    };
    
    totalPhotos += photos.length;
  }
  
  // Write to cityPhotos.json
  const outputPath = path.join(__dirname, '../src/data/cityPhotos.json');
  fs.writeFileSync(outputPath, JSON.stringify(cityPhotos, null, 2), 'utf-8');
  
  console.log('\n' + '='.repeat(50));
  console.log(`✨ 완료!`);
  console.log(`   도시: ${Object.keys(cityPhotos).length}개`);
  console.log(`   사진: ${totalPhotos}장`);
  console.log(`   저장: ${outputPath}`);
}

syncPhotos().catch(console.error);
