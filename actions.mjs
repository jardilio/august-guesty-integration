import GuestyClient from "./guesty-client.mjs"
import AugustClient from "./august-client.mjs";
import Prompt from 'prompt-sync';
import * as config from "./config.mjs";
import fs from "node:fs";

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
    
    console.log(`Finding reservations before ${limit}`);

    await guesty.authenticate();
    const reservations = await guesty.getReservations(0, 5, ['checkIn', 'checkOut', 'guest.fullName', 'guest.phone']);
    const pincodes = reservations.results
        .filter(r => !!r.guest && r.checkIn < limit)
        .map(r => {
            const names =r.guest.fullName.split(' ');
            return {
                firstName: names.shift(),
                lastName: names.join(' '),
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
