import GuestyClient from "./guesty-client.mjs"
import AugustClient from "./august-client.mjs";
import Prompt from 'prompt-sync';
import * as config from "./config.mjs";
import fs from "node:fs";
import { google, Auth } from "googleapis";

const guesty = new GuestyClient({
    username: config.GUESTY_USERNAME,
    password: config.GUESTY_PASSWORD,
    accountId: config.GUESTY_ACCOUNT,
    apiKey: config.GUESTY_API_KEY
});

const august = new AugustClient({
    installId: config.AUGUST_INSTALL_ID,
    password: config.AUGUST_PASSWORD,
    identifier: config.AUGUST_IDENTIFIER,
    apiKey: config.AUGUST_API_KEY
});

export async function getLocks() {
    await august.session();
    let response = await august.fetch('users/locks/mine');
    console.log(await response.json());
}

export function dumpConfig() {
    fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
}

/**
 * Use to validate the apiKey and installId for this application with MFA, 
 * only need to do this once for apiKey and installId. Run again if either 
 * change or authentication is revoked.
 */
export async function validateAugust() {
    console.log(`Sending initial request which will send a validation code to ${august.identifier}`)
    await august.session();
    await august.validate();
    const prompt = Prompt();
    const code = prompt('What is the MFA code returned?');
    await august.validate(code);
    console.log('Done!');
}

/**
 * Checks for Guesty reservations in next 7 days and creates a 
 * temporary access code in August for the guest that only works
 * during the time of their stay.
 */
export async function createGuestPins() {
    const today = new Date(); 
    const limit = new Date(today.setDate(today.getDate() + 7)).toISOString();
    const fields = [
        'checkIn', 
        'checkOut', 
        'guest.firstName', 
        'guest.lastName',
        'guest.phone'
    ];

    console.log(`Finding reservations before ${limit}`);

    await guesty.authenticate();
    const reservations = await guesty.getReservations(0, 5, ['checkIn', 'checkOut', 'guest.fullName', 'guest.phone']);
    const pincodes = reservations.results
        .filter(r => !!r.guest && r.checkIn < limit)
        .map(r => {
            return {
                firstName: r.guest.firstName,
                lastName: r.guest.lastName,
                accessStartTime: new Date(Date.parse(r.checkIn)),
                accessEndTime: new Date(Date.parse(r.checkOut)),
                pin: r.guest.phone ? r.guest.phone.trim().slice(-4) : r.checkIn.split('-')[1] + r.checkIn.split('-')[2],
                lockID: config.AUGUST_LOCK
            }
        });

    console.log(`Found ${pincodes.length} upcoming guest reservations`);

    await august.session();

    // get existing guest access codes from lock and find reservation blocks not yet created
    const existing = await august.getLockPins(config.AUGUST_LOCK);
    const newcodes = pincodes.filter(pincode => {
        return ![].concat(existing.loaded, existing.created).find(e => e.firstName == pincode.firstName && e.lastName == pincode.lastName);
    });

    console.log(`${newcodes.length} guests require an access code which has yet to be created`);

    // commit these one-at-a-time and wait for previous to finish first
    async function commit() {
        if (newcodes.length > 0) {
            const pin = newcodes.shift();
            console.log(`Creating guest access code for ${pin.firstName} ${pin.lastName.charAt(0)}`);
            await august.createGuestEntryPin(pin);
            await commit();
        }
    }

    await commit();
    console.log('Done!');
}

export async function createCalendarEvents() {
    const fields = [
        'source',
        'confirmationCode',
        'listing.address.full',
        'listing.nickname',
        'guest.fullName', 
        'money.hostPayout',
        'money.netIncome',
        'money.ownerRevenue',
        'money.commission',
        'isReturningGuest',
        'nightsCount',
        'guestsCount',
        'status',
        'checkIn',
        'checkOut'
    ];

    const auth = await new Auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/calendar.events'],
            credentials: JSON.parse(config.GOOGLE_CREDENTIALS)
        }).getClient();
    const calendar = google.calendar({version: 'v3', auth});
    const existingEvents = Object.fromEntries((await calendar.events.list({
        calendarId: config.GOOGLE_CALENDAR_ID,
        timeMin: new Date().toISOString(),
        maxResults: 50,
        singleEvents: true,
        orderBy: 'startTime',
    })).data.items.map(e => [e.extendedProperties.private.confirmationCode, e]));
    
    console.log(`Found ${Object.keys(existingEvents).length} existing calendar entries`);

    await guesty.authenticate();
    const reservations = (await guesty.getReservations(0, 25, fields))
        .results
        .filter(r => !!r.guest)
        .map(r => {
            r.money.netIncome = r.money.netIncome || r.money.commission / .2;
            r.money.ownerRevenue = r.money.ownerRevenue || r.money.netIncome - r.money.commission;
            r.description = `${r.guest.fullName} is ${!r.isReturningGuest ? 'not' : ''} a returning guest and ${r.guestsCount} total guests staying at ${r.listing.nickname} for ${r.nightsCount} nights. Reservation ${r.confirmationCode} is ${r.status} on ${r.source} for a total cost of $${r.money.hostPayout} with a net income of $${r.money.netIncome} and estimated owner revenue of $${r.money.ownerRevenue}.`;
            return r;
        });

    console.log(`Found ${reservations.length} reservations`);

    const newEvents = reservations
        .filter(r => !existingEvents[r.confirmationCode])
        .map(r => calendar.events.insert({
            calendarId: config.GOOGLE_CALENDAR_ID,
            requestBody: {
                extendedProperties: {
                    private: {
                        confirmationCode: r.confirmationCode
                    }
                },
                start: {dateTime: r.checkIn},
                end: {dateTime: r.checkOut},
                location: r.listing.address.full,
                summary: r.guest.fullName,
                description: r.description
            }
        }));

    console.log(`Creating ${newEvents.length} new calendar entries`);

    //TODO: Update existing and delete canceled events

    await Promise.all(newEvents);

    console.log('Done!');
}