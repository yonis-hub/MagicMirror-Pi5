import os
import requests
import json
import time
from urllib.parse import urljoin

# --- CONFIGURATION ---
BASE_DIR = "C:\\Users\\hyoni\\OneDrive\\Documents\\DevAppSpace\\Magic_Mirror_v1\\quran_data"
API_BASE = "https://api.quran.com/api/v4"
RECITER_ID = 7  # Mishary Rashid Alafasy

# Ensure base directory exists
if not os.path.exists(BASE_DIR):
    os.makedirs(BASE_DIR)

def download_surah(surah_num):
    print(f"--- Starting Download for Surah {surah_num} ---")

    # 1. Create Surah Directory
    surah_dir = os.path.join(BASE_DIR, str(surah_num).zfill(3))
    if not os.path.exists(surah_dir):
        os.makedirs(surah_dir)

    # 2. Fetch Text (Uthmani)
    print("Fetching Arabic Text...")
    text_url = f"{API_BASE}/quran/verses/uthmani?chapter_number={surah_num}"
    text_resp = requests.get(text_url).json()
    verses_text = text_resp['verses'] # List of objects with 'text_uthmani' and 'verse_key'

    # 3. Loop through verses to get Audio & Timestamps
    for i, verse_data in enumerate(verses_text):
        verse_key = verse_data['verse_key'] # e.g., "1:1"
        verse_id = i + 1
        file_prefix = str(verse_id).zfill(3)

        print(f"Processing Verse {verse_key}...")

        # Fetch Audio & Segments
        recitation_url = f"{API_BASE}/recitations/{RECITER_ID}/by_ayah/{verse_key}"
        print(f"Fetching URL: {recitation_url}")
        rec_resp = requests.get(recitation_url).json()

        # Print API response for debugging
        print(json.dumps(rec_resp, indent=2))

        if 'audio_files' not in rec_resp or len(rec_resp['audio_files']) == 0:
            print(f"Error: No audio files found for verse {verse_key}")
            continue

        audio_url = rec_resp['audio_files'][0]['url']

        # Fix audio URL - use correct base domain
        if not audio_url.startswith('http'):
            audio_url = f"https://download.quranicaudio.com/qdc/{audio_url}"

        # Handle missing segments
        segments = []
        if 'segments' in rec_resp['audio_files'][0]:
            segments = rec_resp['audio_files'][0]['segments']
        else:
            print(f"Warning: No segments found for verse {verse_key}")

        # 4. Save MP3
        mp3_path = os.path.join(surah_dir, f"{file_prefix}.mp3")
        if not os.path.exists(mp3_path):
            audio_data = requests.get(audio_url).content
            with open(mp3_path, 'wb') as f:
                f.write(audio_data)

        # 5. Build & Save Local JSON
        local_data = {
            "verse_key": verse_key,
            "text_uthmani": verse_data['text_uthmani'],
            "segments": segments,
            "segment_present": bool(segments)
        }

        json_path = os.path.join(surah_dir, f"{file_prefix}.json")
        json_string = json.dumps(local_data, ensure_ascii=False, indent=2)
        with open(json_path, 'wb') as f:  # Write as binary
            f.write(json_string.encode('utf-8'))

        # Be nice to the API
        time.sleep(0.2)

    print(f"--- Surah {surah_num} Download Complete ---")

if __name__ == "__main__":
    # Download Surah 2 (Al-Baqarah) for testing
    download_surah(2)
