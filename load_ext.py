from seleniumbase import Driver
from dotenv import load_dotenv
import os

load_dotenv()

def main():
    # Path to your unpacked Chrome extension folder (.crx or unpacked dir)
    EXT_PATH = os.getenv("extpth")

    driver = Driver(
        browser="chrome",
        uc=True,
        headless=False,
        extension_dir=EXT_PATH
    )

    driver.get("https://copter.io")
    input("Press Enter to close...")
    
    # TODO: find a way to add the tamper.js to the tampermonkey extension
    
    driver.quit()

if __name__ == "__main__":
    main()