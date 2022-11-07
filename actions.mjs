import GuestyClient from "./guesty-client.mjs"
import AugustClient from "./august-client.mjs";
import Prompt from 'prompt-sync';
import * as config from "./config.mjs"

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
    await guesty.authenticate();

    // get calendar of days which may or may not contain reservation blocks
    console.log('Finding reservations...');
    const days = await guesty.getCalendar({listing: config.GUESTY_LISTING});
    const reservations = {};

    // reservations repeat in blocks, find unique reservations and store in a hash
    // there can be multiple reservations in a given day considering checkout/checkin times
    days
        .filter(d => d.blockRefs && d.blockRefs.length > 0)
        .map(d => d.blockRefs)
        .forEach(blockRefs => blockRefs
            .map(blockRef => blockRef.reservation)
            .filter(r => r && r.status == 'confirmed')
            .forEach(r => reservations[r._id] = r)
        );

    // build a list of guest pin codes to create for the reservation block
    const pincodes = Object.values(reservations).map(r => {
        const names = r.guest.fullName.split(' ');
        return {
            firstName: names.shift(),
            lastName: names.join(' '),
            accessStartTime: new Date(Date.parse(r.checkIn)),
            accessEndTime: new Date(Date.parse(r.checkOut)),
            pin: r.checkInDateLocalized.split('-')[2] + r.checkOutDateLocalized.split('-')[2],
            lockID: config.AUGUST_LOCK
        };
    });

    console.log(`Found ${pincodes.length} upcoming guest reservations`);

    await august.session(); 

    // get existing guest access codes from lock and find reservation blocks not yet created
    const existing = await august.getLockPins(config.AUGUST_LOCK);
    const newcodes = pincodes.filter(pincode => {
        return !existing.loaded.find(e => e.firstName == pincode.firstName && e.lastName == pincode.lastName);
    });
    
    console.log(`${newcodes.length} guests require an access code which has yet to be created`);

    newcodes.forEach(async (pin) => {
        console.log(`Creating guest access code for ${pin.firstName} ${pin.lastName.charAt(0)}`);
        await august.createGuestEntryPin(pin);
    });

    console.log('Done!');
}