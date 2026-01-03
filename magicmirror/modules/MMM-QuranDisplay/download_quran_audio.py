import os
import requests
from time import sleep

# Verse counts per surah (1-114)
VERSE_COUNTS = [
    7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6
]

BASE_URL = "https://cdn.islamic.network/quran/audio/128/ar.alafasy"
OUTPUT_DIR = "quran_audio"

# Create output directory if not exists
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

# Function to get ayah number for a given surah and verse
def get_ayah_number(surah, verse):
    if surah < 1 or surah > 114:
        return None
    if verse < 1 or verse > VERSE_COUNTS[surah-1]:
        return None
    total = 0
    for i in range(surah-1):
        total += VERSE_COUNTS[i]
    return total + verse

# Download function with retries
def download_file(url, file_path, max_retries=3):
    for attempt in range(max_retries):
        try:
            response = requests.get(url, stream=True)
            response.raise_for_status()
            with open(file_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            return True
        except Exception as e:
            print(f"Attempt {attempt+1} failed: {e}")
            sleep(2)  # wait before retry
    return False

# Download all files
for surah in range(1, 115):  # 1 to 114
    # Create surah directory
    surah_dir = os.path.join(OUTPUT_DIR, f"{surah:03}")
    os.makedirs(surah_dir, exist_ok=True)

    for verse in range(1, VERSE_COUNTS[surah-1]+1):
        ayah_num = get_ayah_number(surah, verse)
        if not ayah_num:
            print(f"Invalid surah/verse: {surah}/{verse}")
            continue

        url = f"{BASE_URL}/{ayah_num}.mp3"
        file_path = os.path.join(surah_dir, f"{verse:03}.mp3")

        # Skip if file already exists
        if os.path.exists(file_path):
            print(f"Skipping existing: {file_path}")
            continue

        print(f"Downloading surah {surah} verse {verse} from {url}...")
        if download_file(url, file_path):
            print(f"Saved to {file_path}")
        else:
            print(f"Failed to download {url}")

        # Be polite: sleep a bit between requests
        sleep(0.5)

print("Done!")
