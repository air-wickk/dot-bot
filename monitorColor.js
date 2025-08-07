const { ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = async function monitorColor({
    launchBrowser,
    getCenterColor,
    colorDetector,
    client,
    CHANNEL_ID,
    BLUE_ROLE_ID
}) {
    let lastColor = null;
    let lastBlueNotificationTime = 0;
    let lastNotificationMessage = null;
    let consecutiveBlueChecks = 0;
    let nonBlueChecks = 0;
    let lastUpdateTime = Date.now();

    await launchBrowser();

    // Load all image file paths from the blue-images folder
    const blueImagesDir = path.join(__dirname, 'blue-images');
    const blueImages = fs.readdirSync(blueImagesDir)
        .filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file))
        .map(file => path.join(blueImagesDir, file));

    let lastMessageWasImage = false;

    setInterval(async () => {
        try {
            if (!global.browser || !global.page || global.page.isClosed()) {
                console.warn('Browser or page closed. Relaunching...');
                await launchBrowser();
            }

            const color = await getCenterColor(global.page);

            if (color) {
                lastUpdateTime = Date.now();
                colorDetector.addToColorLog(color);

                // ...activityStatusMap, messageContentMap, customEmojiMap definitions...

                const activityStatusMap = {
                    '<:red:1324226477268406353>': '🔴',
                    '<:orangered:1324226458465337365>': '🟠',
                    '<:orange:1324226439796621322>': '🟠',
                    '<:yelloworange:1324226423568728074>': '🟡',
                    '<:yellow:1324226408783810603>': '🟡',
                    '<:greenyellow:1324226389859373086>': '🟢',
                    '<:green:1324226357663633508>': '🟢',
                    '<:cyangreen:1324226321253142539>': '🟢',
                    '<:cyan:1324226273794461706>': '🔵',
                    '<:bluecyan:1324224790164144128>': '🔵',
                    '<:darkblue:1324224216651923519>': '🔵',
                };

                const messageContentMap = {
                    '<:red:1324226477268406353>': 'red',
                    '<:orangered:1324226458465337365>': 'orange-red',
                    '<:orange:1324226439796621322>': 'orange',
                    '<:yelloworange:1324226423568728074>': 'yellow-orange',
                    '<:yellow:1324226408783810603>': 'yellow',
                    '<:greenyellow:1324226389859373086>': 'green-yellow',
                    '<:green:1324226357663633508>': 'green',
                    '<:cyangreen:1324226321253142539>': 'cyan-green',
                    '<:cyan:1324226273794461706>': 'light blue',
                    '<:bluecyan:1324224790164144128>': 'blue',
                    '<:darkblue:1324224216651923519>': 'dark blue',
                };

                const customEmojiMap = {
                    '<:red:1324226477268406353>': '<:red:1324226477268406353>',
                    '<:orangered:1324226458465337365>': '<:orangered:1324226458465337365>',
                    '<:orange:1324226439796621322>': '<:orange:1324226439796621322>',
                    '<:yelloworange:1324226423568728074>': '<:yelloworange:1324226423568728074>',
                    '<:yellow:1324226408783810603>': '<:yellow:1324226408783810603>',
                    '<:greenyellow:1324226389859373086>': '<:greenyellow:1324226389859373086>',
                    '<:green:1324226357663633508>': '<:green:1324226357663633508>',
                    '<:cyangreen:1324226321253142539>': '<:cyangreen:1324226321253142539>',
                    '<:cyan:1324226273794461706>': '<:cyan:1324226273794461706>',
                    '<:bluecyan:1324224790164144128>': '<:bluecyan:1324224790164144128>',
                    '<:darkblue:1324224216651923519>': '<:darkblue:1324224216651923519>',
                };

                const statusEmoji = activityStatusMap[color] || '⚪';
                const customEmoji = customEmojiMap[color] || '⚪';
                const statusWord = messageContentMap[color] || 'unknown';

                client.user.setPresence({
                    activities: [{ name: `the dot: ${statusEmoji}`, type: ActivityType.Watching }],
                    status: 'online',
                });

                const isBlue = [
                    '<:bluecyan:1324224790164144128>',
                    '<:darkblue:1324224216651923519>'
                ].includes(color);

                // Only send random image if the dot is exactly "blue" (not dark blue or light blue)
                if (color === '<:bluecyan:1324224790164144128>') {
                    consecutiveBlueChecks++;
                    nonBlueChecks = 0;
                    if (consecutiveBlueChecks >= 4) {
                        const channel = await client.channels.fetch(CHANNEL_ID);

                        if (!lastNotificationMessage) {
                            if (blueImages.length > 0 && Math.random() <= 0.05) {
                                const randomImage = blueImages[Math.floor(Math.random() * blueImages.length)];
                                lastNotificationMessage = await channel.send({
                                    files: [randomImage],
                                    allowedMentions: { roles: [BLUE_ROLE_ID] },
                                    flags: 1 << 12
                                });
                                lastMessageWasImage = true;
                                lastBlueNotificationTime = Date.now();
                                console.log(`Sent random blue image for color: ${color}`);
                            } else {
                                lastNotificationMessage = await channel.send({
                                    content: `${customEmoji} **The dot is blue!**`,
                                    allowedMentions: { roles: [BLUE_ROLE_ID] },
                                    flags: 1 << 12
                                });
                                lastMessageWasImage = false;
                                lastBlueNotificationTime = Date.now();
                                console.log(`Notification sent for color: ${color}`);
                            }
                        } else if (!lastMessageWasImage) {
                            await lastNotificationMessage.edit({
                                content: `${customEmoji} **The dot is blue!**`
                            });
                            console.log(`Edited message to reflect color: ${color}`);
                        }
                        // If last message was an image, do not edit it until dot is no longer blue
                    }
                } else if (isBlue) {
                    // For "dark blue", keep the old behavior
                    consecutiveBlueChecks++;
                    nonBlueChecks = 0;
                    if (consecutiveBlueChecks >= 4) {
                        const channel = await client.channels.fetch(CHANNEL_ID);
                        if (!lastNotificationMessage) {
                            lastNotificationMessage = await channel.send({
                                content: `${customEmoji} **The dot is dark blue!**`,
                                allowedMentions: { roles: [BLUE_ROLE_ID] },
                                flags: 1 << 12
                            });
                            lastMessageWasImage = false;
                            lastBlueNotificationTime = Date.now();
                            console.log(`Notification sent for color: ${color}`);
                        } else if (!lastMessageWasImage) {
                            await lastNotificationMessage.edit({
                                content: `${customEmoji} **The dot is dark blue!**`
                            });
                            console.log(`Edited message to reflect color: ${color}`);
                        }
                    }
                } else {
                    consecutiveBlueChecks = 0;
                    if (lastNotificationMessage) {
                        nonBlueChecks++;
                        // 8 checks * 15s = 120s = 2 minutes
                        if (nonBlueChecks >= 8) {
                            try {
                                await lastNotificationMessage.delete();
                                lastNotificationMessage = null;
                                lastMessageWasImage = false;
                                nonBlueChecks = 0;
                                console.log('Deleted the last notification message as the dot is not blue for 2 minutes.');
                            } catch (error) {
                                console.warn('Failed to delete the last notification message:', error.message);
                            }
                        }
                    }
                    // Reset if dot is not blue and no message exists
                    if (!lastNotificationMessage) {
                        nonBlueChecks = 0;
                    }
                }
                lastColor = color;
            }
        } catch (error) {
            console.error('Error in color detection loop:', error);
        }
    }, 15000);
};