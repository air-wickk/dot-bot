// node bot.js to run
const puppeteer = require('puppeteer');
const { Client, GatewayIntentBits, SlashCommandBuilder, ActivityType, REST, Routes } = require('discord.js');
const express = require('express');
require('dotenv').config();

// Load environment variables
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const TEST_CHANNEL_ID = process.env.DISCORD_TEST_CHANNEL_ID;
const BLUE_ROLE_ID = process.env.BLUE_ROLE_ID;

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Express server for Render compatibility
const app = express();

// Simple health check endpoint
app.get('/', (req, res) => {
    res.send('Bot is running');
});

// Set the port to listen on
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Web service listening on port ${port}`);
});

// 📊 Color Tracking Data
let colorLog = [];

// 📊 Function to classify color into categories using Euclidean distance
function classifyColor(r, g, b) {
    const hsl = rgbToHsl(r, g, b);
    const hue = hsl[0];

    // Mapping the hue to the closest custom emojis based on hue values
    const colors = [
        { emoji: '<:red:1324226477268406353>', min: 0, max: 10 }, // Red
        { emoji: '<:orangered:1324226458465337365>', min: 10, max: 30 }, // Orange-Red
        { emoji: '<:orange:1324226439796621322>', min: 30, max: 50 }, // Orange
        { emoji: '<:yelloworange:1324226423568728074>', min: 50, max: 70 }, // Yellow-Orange
        { emoji: '<:yellow:1324226408783810603>', min: 70, max: 90 }, // Yellow
        { emoji: '<:greenyellow:1324226389859373086>', min: 90, max: 120 }, // Green-Yellow
        { emoji: '<:green:1324226357663633508>', min: 120, max: 150 }, // Green
        { emoji: '<:cyangreen:1324226321253142539>', min: 150, max: 170 }, // Cyan-Green
        { emoji: '<:cyan:1324226273794461706>', min: 170, max: 190 }, // Cyan
        { emoji: '<:bluecyan:1324224790164144128>', min: 190, max: 210 }, // Blue-Cyan
        { emoji: '<:darkblue:1324224216651923519>', min: 210, max: 250 }, // Dark Blue
    ];

    let closestColor = 'Unknown';

    for (let color of colors) {
        if (hue >= color.min && hue < color.max) {
            closestColor = color.emoji;
            break;
        }
    }

    return closestColor;
}

// 📊 Function to convert RGB to HSL
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
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

// 📊 Function to get the center color of the page using canvas
async function getCenterColor(page) {
    try {
        const screenshot = await page.screenshot({
            fullPage: true,
            encoding: 'base64',
            timeout: 30000,
        });
        
        if (!screenshot) {
            throw new Error('Failed to capture screenshot.');
        }        

        const color = await page.evaluate((screenshot) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.src = 'data:image/png;base64,' + screenshot;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    
                    try {
                        const pixel = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
                        resolve([pixel[0], pixel[1], pixel[2]]);
                    } catch (err) {
                        reject('Failed to get image data: ' + err.message);
                    }
                };
                img.onerror = (err) => reject('Failed to load image: ' + err.message);
            });
        }, screenshot);        

        return classifyColor(color[0], color[1], color[2]);
    } catch (error) {
        console.error('Error fetching color:', error);
        return null;
    }
}

// 🚨 Monitor center color and send Discord alerts for "Blue"
async function monitorColor() {
    let browser, page;
    try {
        async function launchBrowser() {
            let browser;
            let page;
        
            try {
                // Launch the browser with recommended arguments
                browser = await puppeteer.launch({
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                });
        
                // Open a new page
                page = await browser.newPage();
        
                // Set a default viewport
                await page.setViewport({ width: 1920, height: 1080 });
        
                // Navigate to the desired page and ensure it's fully loaded
                await page.goto('https://dot-bot-a809.onrender.com', {
                    waitUntil: 'networkidle2', // Wait until there are no more than 2 network connections for 500ms
                    timeout: 60000, // 60-second timeout
                });
        
                console.log('Browser launched and page fully loaded.');
                return { browser, page };
        
            } catch (error) {
                console.error('Error during browser launch:', error);
        
                if (browser) {
                    await browser.close();
                }
        
                throw error;
            }
        }

        // Launch browser initially
        await launchBrowser();

        let lastColor = null;
        let blueAnnounced = false;
        setInterval(async () => {
            if (!page || page.isClosed()) {
                console.log("Reinitializing browser and page...");
                const result = await launchBrowser();
                browser = result.browser;
                page = result.page;
            }            

            const color = await getCenterColor(page);
            let statusEmoji = '🔵'; // Default to blue for the activity status

            if (color && color !== lastColor) {
                colorLog.push({ color, timestamp: Date.now() });

                // Check for specific colors and map to the general emojis for the activity status
                if (color === '<:red:1324226477268406353>') {
                    statusEmoji = '🔴';
                } else if (color === '<:orangered:1324226458465337365>') {
                    statusEmoji = '🟠';
                } else if (color === '<:orange:1324226439796621322>') {
                    statusEmoji = '🟡';
                } else if (color === '<:yelloworange:1324226423568728074>') {
                    statusEmoji = '🟡';
                } else if (color === '<:yellow:1324226408783810603>') {
                    statusEmoji = '🟡';
                } else if (color === '<:greenyellow:1324226389859373086>') {
                    statusEmoji = '🟢';
                } else if (color === '<:green:1324226357663633508>') {
                    statusEmoji = '🟢';
                } else if (color === '<:cyangreen:1324226321253142539>') {
                    statusEmoji = '🟢';
                } else if (color === '<:cyan:1324226273794461706>') {
                    statusEmoji = '🟢';
                } else if (color === '<:bluecyan:1324224790164144128>') {
                    statusEmoji = '🔵';
                } else if (color === '<:darkblue:1324224216651923519>') {
                    statusEmoji = '🔵';
                }

                // Update bot activity status to the emoji based on detected color
                if (color !== lastColor) {
                    client.user.setPresence({
                        activities: [{ name: `the dot: ${statusEmoji}`, type: ActivityType.Watching }],
                        status: 'online',
                    });
                    lastColor = color;
                }                

     // Announce blue only if it wasn't already announced
        if ((color === '<:bluecyan:1324224790164144128>' || color === '<:darkblue:1324224216651923519>') && !blueAnnounced) {
            const channel = await client.channels.fetch(CHANNEL_ID);
            await channel.send({
                content: `<:darkblue:1324224216651923519> **The dot is blue!**`,
                allowedMentions: { roles: [BLUE_ROLE_ID] }
            });
            blueAnnounced = true; // Prevent repeat announcements
        } else if (color !== '<:bluecyan:1324224790164144128>' && color !== '<:darkblue:1324224216651923519>') {
            blueAnnounced = false; // Reset if color is no longer blue
        }

        lastColor = color;
    }
}, 15000);

        // Restart the browser every hour
        setInterval(async () => {
            console.log("Restarting browser...");
            await launchBrowser();
        }, 3600000); // 1 hour in milliseconds

    } catch (error) {
        console.error("Error during color monitoring:", error);
    }
}

// 🗨️ Commands
client.on('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    
    /* Delete global commands

    const clientId = "1323744486811111473"; // bot's client ID here
    const commandId = "1324218706997542913"; // command ID to delete

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try {
        await rest.delete(Routes.applicationCommand(clientId, commandId));
        console.log('Successfully deleted the global command');
    } catch (error) {
        console.error('Error deleting command:', error);
    }
    */

    // Register new command
    await client.application.commands.create(
        new SlashCommandBuilder().setName('dotcolor').setDescription('Get the current color of the dot!')
    );
    
    monitorColor();
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'dotcolor') {
        await interaction.reply('🔍 Checking the dot, please wait...');
        const color = colorLog[colorLog.length - 1]?.color || 'Unknown';
        await interaction.editReply(`**The dot is** ${color} **right now**`);
    }
});

client.login(BOT_TOKEN);