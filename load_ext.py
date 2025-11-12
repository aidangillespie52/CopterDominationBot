from seleniumbase import Driver
from dotenv import load_dotenv
import os

load_dotenv()

def main():
    # Path to your unpacked Chrome extension folder (.crx or unpacked dir)
    EXT_PATH = os.getenv("extpth")

    driver = Driver(
        browser="chrome",
        uc=True,               # optional (undetected mode)
        headless=False,
        extensions=[EXT_PATH]  # 👈 add your extension here
    )

    driver.get("https://copter.io")
    input("Press Enter to close...")
    driver.quit()

if __name__ == "__main__":
    main()