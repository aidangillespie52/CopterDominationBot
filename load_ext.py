from seleniumbase import SB
from dotenv import load_dotenv
import os

load_dotenv()

def main():
    # Path to your unpacked Chrome extension folder (.crx or unpacked dir)
    PROFILE_PATH = os.getenv("PROFILE_PATH")
    EXT_PATH = os.getenv("EXT_PATH")

    with SB(uc=True, user_data_dir=PROFILE_PATH, headed=True, extension_zip=EXT_PATH) as sb:
        sb.open("https://copter.io")
        input("Press Enter to close...")
    
    # TODO: find a way to add the tamper.js to the tampermonkey extension
    
if __name__ == "__main__":
    main()