from seleniumbase import SB
from dotenv import load_dotenv
import os

load_dotenv()

def main():
    # Path to your unpacked Chrome extension folder (.crx or unpacked dir)
    PROFILE_PATH = os.getenv("extpth")

    with SB(uc=True, user_data_dir=PROFILE_PATH, headed=True) as sb:
        sb.open("https://copter.io")
        input("Press Enter to close...")
    
    # TODO: find a way to add the tamper.js to the tampermonkey extension
    
if __name__ == "__main__":
    main()