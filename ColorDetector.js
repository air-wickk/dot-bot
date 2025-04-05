const puppeteer = require('puppeteer');

// Encapsulate color detection logic into a class
class ColorDetector {
    constructor(maxLogSize = 20) {
        this.colorLog = [];
        this.MAX_COLOR_LOG_SIZE = maxLogSize;
    }

    // Add color to the log with size restriction
    addToColorLog(color) {
        const currentTimestamp = Date.now();
        this.colorLog.push({ color, timestamp: currentTimestamp });
        if (this.colorLog.length > this.MAX_COLOR_LOG_SIZE) {
            this.colorLog.shift(); // Remove the oldest entry if the log exceeds the max size
        }
    }

    // Classify color into categories using Euclidean distance
    classifyColor(r, g, b) {
        const hsl = this.rgbToHsl(r, g, b);
        const hue = hsl[0];
        const saturation = hsl[1] * 100; // Convert to percentage for easier reading
        const lightness = hsl[2] * 100; // Convert to percentage for easier reading

        const colors = [
            { emoji: '<:red:1324226477268406353>', min: 0, max: 10 },
            { emoji: '<:orangered:1324226458465337365>', min: 10, max: 30 },
            { emoji: '<:orange:1324226439796621322>', min: 30, max: 50 },
            { emoji: '<:yelloworange:1324226423568728074>', min: 50, max: 70 },
            { emoji: '<:yellow:1324226408783810603>', min: 70, max: 90 },
            { emoji: '<:greenyellow:1324226389859373086>', min: 90, max: 120 },
            { emoji: '<:green:1324226357663633508>', min: 120, max: 150 },
            { emoji: '<:cyangreen:1324226321253142539>', min: 150, max: 170 },
            { emoji: '<:cyan:1324226273794461706>', min: 170, max: 195 },
            { emoji: '<:bluecyan:1324224790164144128>', min: 195, max: 220 },
            { emoji: '<:darkblue:1324224216651923519>', min: 220, max: 255 },
        ];

        let closestColor = '<:pink:1326324208279490581>'; // Default to pink if no match

        for (let color of colors) {
            if (hue >= color.min && hue < color.max) {
                closestColor = color.emoji;
                break;
            }
        }

        if (
            closestColor === '<:red:1324226477268406353>' &&
            saturation < 30 &&
            lightness > 70
        ) {
            closestColor = '<:pink:1326324208279490581>';
        }

        return closestColor;
    }

    // Convert RGB to HSL
    rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        let max = Math.max(r, g, b),
            min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0;
        } else {
            let d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else if (max === b) h = (r - g) / d + 4;
            h /= 6;
        }
        return [h * 360, s, l];
    }

    // Get the most recent color
    getLastColor() {
        return this.colorLog[this.colorLog.length - 1]?.color || 'Unknown';
    }

    // Get the color log
    getColorLog() {
        return this.colorLog;
    }
}

// Export the class for use in other files
module.exports = ColorDetector;

// Instantiate the ColorDetector
const colorDetector = new ColorDetector();

// Update the rest of the code to use the `colorDetector` instance
async function getCenterColor(page, retries = 3) {
    try {
        if (!browser || !page || page.isClosed()) {
            console.warn('Browser or page is not valid. Relaunching...');
            await launchBrowser();
        }

        let screenshot;

        for (let i = 0; i < retries; i++) {
            try {
                const isPageOk = await page.evaluate(() => document.readyState === 'complete');
                if (!isPageOk) {
                    console.warn('Page not fully loaded. Reloading...');
                    await page.reload({ waitUntil: 'load' });
                    await new Promise(r => setTimeout(r, 2000));
                }

                await new Promise(r => setTimeout(r, 2000)); // Stability delay
                screenshot = await page.screenshot({
                    fullPage: true,
                    encoding: 'base64',
                    timeout: 60000,
                });

                if (screenshot) break;
            } catch (error) {
                console.warn(`Retry ${i + 1}: Failed to take screenshot`, error.message);
                if (i === retries - 1) throw error;
                await new Promise(res => setTimeout(res, 2000));
            }
        }

        if (!screenshot) {
            console.error('Failed to capture screenshot after retries.');
            return null;
        }

        const color = await page.evaluate((screenshot) => {
            return new Promise((resolve, reject) => {
                try {
                    const img = new Image();
                    img.src = 'data:image/png;base64,' + screenshot;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        const pixel = ctx.getImageData(
                            Math.floor(canvas.width / 2),
                            Math.floor(canvas.height / 2),
                            1,
                            1
                        ).data;
                        resolve([pixel[0], pixel[1], pixel[2]]);
                    };
                    img.onerror = () => reject(new Error('Failed to load image onto canvas'));
                } catch (err) {
                    reject(err);
                }
            });
        }, screenshot);

        return colorDetector.classifyColor(color[0], color[1], color[2]);

    } catch (error) {
        console.error('Error in getCenterColor:', error.message);
        return null;
    }
}

// Update other parts of the code to use `colorDetector` for logging and classification
// Example: Replace `addToColorLog` with `colorDetector.addToColorLog(color)`
// Example: Replace `colorLog` with `colorDetector.getColorLog()`