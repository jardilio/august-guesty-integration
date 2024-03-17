import GuestyClient from "./guesty-client.mjs"
import AugustClient from "./august-client.mjs";
import Prompt from 'prompt-sync';
import * as config from "./config.mjs";
import fs from "node:fs";
import crypto from "node:crypto";
import { google, Auth } from "googleapis";

const UsDollars = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});

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
        'guest.fullName',
        'guest.phone'
    ];

    console.log(`Finding reservations before ${limit}`);

    await guesty.authenticate();
    const reservations = await guesty.getReservations(0, 5, ['checkIn', 'checkOut', 'guest.fullName', 'guest.phone']);
    const pincodes = reservations.results
        .filter(r => !!r.guest && r.checkIn < limit)
        .map(r => {
            const names = r.guest.fullName.split(" ");
            return {
                firstName: names[0],
                lastName: names[1],
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
        const name = pincode.firstName.trim().toLowerCase() + pincode.lastName.trim().toLowerCase();
        return ![].concat(existing.loaded, existing.created).find(e => e.firstName.trim().toLowerCase() + e.lastName.trim().toLowerCase() == name);
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

    await guesty.authenticate();
    const resEvents = (await guesty.getReservations(0, 25, fields))
        .results
        .filter(r => !!r.guest && !!r.confirmationCode)
        .map(r => getCalendarEventFromReservation(r));

    console.log(`Found ${resEvents.length} reservations`);

    const auth = await new Auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/calendar.events'],
            credentials: JSON.parse(config.GOOGLE_CREDENTIALS)
        }).getClient();
    const calendar = google.calendar({version: 'v3', auth});

    /*const existingEvents2 = (await calendar.events.list({
        calendarId: config.GOOGLE_CALENDAR_ID,
        timeMin: (resEvents[0] && resEvents[0].start) || new Date().toISOString(),
        maxResults: 50,
        singleEvents: true,
        orderBy: 'startTime',
    })).data.items;

    existingEvents2.forEach(e => calendar.events.delete({
        calendarId: config.GOOGLE_CALENDAR_ID,
        eventId: e.id
    }));

    console.log(`Deleting ${existingEvents2.length} calendar entries`);

    await Promise.all(existingEvents2);

    return;*/

    const existingEvents = Object.fromEntries((await calendar.events.list({
        calendarId: config.GOOGLE_CALENDAR_ID,
        timeMin: (resEvents[0] && resEvents[0].start) || new Date().toISOString(),
        maxResults: 50,
        singleEvents: true,
        orderBy: 'startTime',
    })).data.items.map(e => [e.extendedProperties.private.reservationId, e]));
    
    console.log(`Found ${Object.keys(existingEvents).length} existing calendar entries`);

    const newEvents = resEvents
        .filter(r => {
            const existing = existingEvents[r.extendedProperties.private.reservationId];
            return !existing && r.status !== 'cancelled';
        })
        .map(r => calendar.events.insert({
            calendarId: config.GOOGLE_CALENDAR_ID,
            requestBody: r
        }));

    console.log(`Creating ${newEvents.length} new calendar entries`);

    await Promise.all(newEvents);

    const updatedEvents = resEvents
        .filter(r => {
            const existing = existingEvents[r.extendedProperties.private.reservationId];
            return existing && existing.extendedProperties.private.hash !== r.extendedProperties.private.hash;
        })
        .map(r => calendar.events.update({
            calendarId: config.GOOGLE_CALENDAR_ID,
            eventId: existingEvents[r.extendedProperties.private.reservationId].id,
            requestBody: r
        }));

    console.log(`Updating ${updatedEvents.length} existing calendar entries`);

    await Promise.all(updatedEvents);

    //TODO: Delete canceled events

    /* const deletedEvents = resEvents
        .filter(r => {
            const existing = existingEvents[r.extendedProperties.private.reservationId];
            return existing && (r.status == 'cancelled' || !r.confirmationCode);
        })
        .map(r => calendar.events.delete({
            calendarId: config.GOOGLE_CALENDAR_ID,
            eventId: existingEvents[r.extendedProperties.private.reservationId].id,
            requestBody: r
        }));

    console.log(`Deleting ${deletedEvents.length} existing calendar entries`);*/

    console.log('Done!');
}

function getCalendarEventFromReservation(r) {
    const lastUpdated = r.log && r.log[0] ? r.log[0].at : r.createdAt;
    let status;

    fixReservationMoney(r);

    switch(r.status) {
        case 'inquiry':
            status = 'tentative';
            break;
        case 'canceled':
        case 'cancelled':
        case 'declined':
        case 'expired':
        case 'closed':
            status = 'cancelled';
            break;
        default:
            status = 'confirmed';
            break;
    }

    const event = {
        extendedProperties: {
            private: {
                confirmationCode: r.confirmationCode,
                lastUpdated: lastUpdated,
                reservationId: r._id
            }
        },
        start: {dateTime: r.checkIn},
        end: {dateTime: r.checkOut},
        location: r.listing.address.full,
        summary: r.guest.fullName,
        description: `${r.guest.fullName} is ${r.isReturningGuest ? 'returning' : 'new'} guest with ${r.guestsCount} total guests staying at ${r.listing.nickname} for ${r.nightsCount} nights. Reservation ${r.confirmationCode} is ${r.status} on ${r.source} for a total cost of ${UsDollars.format(r.money.hostPayout)} with a net income of ${UsDollars.format(r.money.netIncome)} and estimated owner revenue of ${UsDollars.format(r.money.ownerRevenue)}. The average nightly revenue is ${UsDollars.format(r.money.ownerRevenue / r.nightsCount)} per night.`,
        status: status
    };

    event.extendedProperties.private.hash = crypto.createHash('md5').update(JSON.stringify(event)).digest('hex');

    return event;
}

function fixReservationMoney(r) {
    r.money.netIncome = r.money.netIncome || r.money.commission / .2;
    r.money.ownerRevenue = r.money.ownerRevenue || r.money.netIncome - r.money.commission;
    return r;
}

export async function exportReservationReports() {
    const fields = [
        'confirmationCode',
        'source',
        'guest.fullName', 
        'money.hostPayout',
        'money.netIncome',
        'money.netIncomeFormula',
        'money.ownerRevenue',
        'money.ownerRevenueFormula',
        'money.commission',
        'money.commissionFormula',
        'money.totalPaid',
        'money.totalTaxes',
        'money.invoiceItems',
        'isReturningGuest',
        'nightsCount',
        'guestsCount',
        'status',
        'checkIn',
        'checkOut'
    ];

    const filters = [
        {
            field: 'checkIn',
            operator: '$gt',
            value: 0
        }
    ];

    const auth = await new Auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        credentials: JSON.parse(config.GOOGLE_CREDENTIALS)
    }).getClient();
    const sheets = google.sheets({version: 'v4', auth});
    const rows = [];

    await guesty.authenticate();

    async function getRows(skip) {
        const reservations = await guesty.getReservations(skip, 25, fields, filters);
        const results = reservations
            .results
            .map(r => {
                fixReservationMoney(r);
                const checkInYear = r.checkIn.substring(0,4);
                const checkInMonth = r.checkIn.substring(5, 7);
                const checkInDay = Number(r.checkIn.substring(8, 10));
                const checkInMonthDays = new Date(checkInYear, checkInMonth, 0).getDate();
                const checkInMonthNights = Math.min(r.nightsCount, checkInMonthDays-checkInDay+1);
                const nightlyOwnerRevenue = r.money.ownerRevenue / r.nightsCount
                return [
                    r.confirmationCode,
                    r.source,
                    r.guest.fullName,
                    r.money.hostPayout,
                    UsDollars.format(r.money.netIncome),
                    r.money.netIncomeFormula,
                    UsDollars.format(r.money.ownerRevenue),
                    r.money.ownerRevenueFormula,
                    UsDollars.format(r.money.commission),
                    r.money.commissionFormula,
                    UsDollars.format(r.money.totalPaid),
                    UsDollars.format(r.money.totalTaxes),
                    r.money.invoiceItems
                        .map(i => `${i.title}: ${UsDollars.format(i.amount)}`)
                        .join(', '),
                    r.isReturningGuest,
                    r.nightsCount,
                    r.guestsCount,
                    r.status,
                    r.checkIn.substring(0, 10),
                    r.checkOut.substring(0, 10),
                    UsDollars.format(nightlyOwnerRevenue),
                    checkInYear,
                    checkInMonth,
                    checkInMonthNights,
                    UsDollars.format(nightlyOwnerRevenue * checkInMonthNights),
                    r.checkOut.substring(0,4),
                    r.checkOut.substring(5, 7),
                    r.nightsCount - checkInMonthNights,
                    UsDollars.format(nightlyOwnerRevenue * (r.nightsCount - checkInMonthNights))
                ];
            });
        rows.push.apply(rows, results);

        if (rows.length < reservations.count) {
            await getRows(rows.length);
        }
    }

    await getRows(0);

    // add header row
    rows.unshift(fields.concat(
        'money.nightlyOwnerRevenue',
        'checkIn.year',
        'checkIn.month',
        'checkIn.month.nights',
        'checkIn.month.ownerRevenue',
        'checkOut.year',
        'checkOut.month',
        'checkOut.month.nights',
        'checkOut.month.ownerRevenue'
    ));
    
    await sheets.spreadsheets.values.clear({
        spreadsheetId: config.GOOGLE_SHEET_ID,
        range: 'Data!A:ZZ'
    });

    await sheets.spreadsheets.values.append({
        spreadsheetId: config.GOOGLE_SHEET_ID,
        range: 'Data!A1',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'OVERWRITE',
        resource: {
            majorDimension: 'ROWS',
            values: rows
        }
    });
}