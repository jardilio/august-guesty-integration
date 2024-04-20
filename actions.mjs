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
        'guest.phone',
        'status'
    ];

    console.log(`Finding reservations before ${limit}`);

    await guesty.authenticate();
    const reservations = await guesty.getReservations(0, 5, fields);
    const pincodes = reservations.results
        .filter(r => r.status == 'confirmed' && !!r.guest && r.checkIn < limit)
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
        'money.fareCleaning',
        'money.invoiceItems',
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
            return !existing && r.status == 'confirmed';
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
            return existing && r.status == 'confirmed' && existing.extendedProperties.private.hash !== r.extendedProperties.private.hash;
        })
        .map(r => calendar.events.update({
            calendarId: config.GOOGLE_CALENDAR_ID,
            eventId: existingEvents[r.extendedProperties.private.reservationId].id,
            requestBody: r
        }));

    console.log(`Updating ${updatedEvents.length} existing calendar entries`);

    await Promise.all(updatedEvents);

    //TODO: Delete canceled events

    const deletedEvents = resEvents
        .filter(r => {
            const existing = existingEvents[r.extendedProperties.private.reservationId];
            return existing && r.status !== 'confirmed';
        })
        .map(r => calendar.events.delete({
            calendarId: config.GOOGLE_CALENDAR_ID,
            eventId: existingEvents[r.extendedProperties.private.reservationId].id,
            requestBody: r
        }));

    console.log(`Deleting ${deletedEvents.length} existing calendar entries`);

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

const   STATE_TAX_RATE = 0.065, 
        COUNTY_TAX_RATE = 0.050,
        CREDIT_CARD_RATE = 0.0287,
        HOST_CHANNEL_RATE = 0.0446;

function fixReservationMoney(r) {
    if (r.adjustments) return r;

    const adjustments = {
        hostChannelFees: Math.abs(r.money.invoiceItems.reduce((value, i) => i.title.toLowerCase() == 'host channel fee' ? i.amount : value, r.money.hostPayout * HOST_CHANNEL_RATE)),
        creditCardFees: r.source.toLowerCase().startsWith('airbnb') ? 0 : r.money.hostPayout * CREDIT_CARD_RATE,
        insuranceFees: r.money.invoiceItems.reduce((value, i) => {
            switch(i.title.toLowerCase()) {
                case 'management fee':
                case 'incidentals fee':
                    return i.amount;
                default: 
                    return value;
            }
        }, 0),
        vat: r.money.invoiceItems.reduce((value, i) => i.title.toLowerCase() == 'vat' ? i.amount : value, 0),
        fareCleaning: r.nightsCount > 7 ? 265 : 165,
        grossWithTaxes: 0,
        taxableGross: 0,
        stateTaxes: 0,
        countyTaxes: 0,
        commission: 0,
        ownerRevenue: 0,
        netIncome: 0
    };

    adjustments.grossWithTaxes = r.money.hostPayout - (r.source.toLowerCase().startsWith('airbnb') ? 0 : adjustments.hostChannelFees) - adjustments.creditCardFees - adjustments.insuranceFees;
    adjustments.taxableGross = adjustments.grossWithTaxes / (1 + (adjustments.vat > 0 ? STATE_TAX_RATE + COUNTY_TAX_RATE : COUNTY_TAX_RATE));
    adjustments.stateTaxes = adjustments.vat > 0 ? adjustments.taxableGross * STATE_TAX_RATE : 0;
    adjustments.countyTaxes = adjustments.taxableGross * COUNTY_TAX_RATE;
    adjustments.netIncome = adjustments.grossWithTaxes - adjustments.stateTaxes - adjustments.countyTaxes - adjustments.fareCleaning;
    adjustments.commission = adjustments.netIncome * 0.2;
    adjustments.ownerRevenue = adjustments.netIncome * 0.8;
    
    r.money.netIncome = adjustments.netIncome;
    r.money.ownerRevenue = adjustments.ownerRevenue;
    r.money.commission = adjustments.commission;
    r.money.fareCleaning = adjustments.fareCleaning;
    r.money.totalTaxes = adjustments.stateTaxes + adjustments.countyTaxes;
    r.money.hostPayout = adjustments.grossWithTaxes;
    r.money.adjustments = adjustments;
    
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
        'money.fareCleaning',
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
                    r._id,
                    r.confirmationCode,
                    r.source,
                    r.guest.fullName,
                    r.money.hostPayout,
                    UsDollars.format(r.money.netIncome || 0),
                    r.money.netIncomeFormula,
                    UsDollars.format(r.money.ownerRevenue || 0),
                    r.money.ownerRevenueFormula,
                    UsDollars.format(r.money.commission || 0),
                    r.money.commissionFormula,
                    UsDollars.format(r.money.totalPaid || 0),
                    UsDollars.format(r.money.totalTaxes || 0),
                    UsDollars.format(r.money.fareCleaning || 0),
                    r.money.invoiceItems
                        .map(i => `${i.title}: ${UsDollars.format(i.amount || 0)}`)
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
                    UsDollars.format(nightlyOwnerRevenue * (r.nightsCount - checkInMonthNights)),
                    UsDollars.format(r.money.adjustments.stateTaxes),
                    UsDollars.format(r.money.adjustments.countyTaxes),
                    UsDollars.format(r.money.adjustments.taxableGross),
                    UsDollars.format(r.money.adjustments.creditCardFees),
                    UsDollars.format(r.money.adjustments.insuranceFees),
                    UsDollars.format(r.money.adjustments.hostChannelFees)
                ];
            });
        rows.push.apply(rows, results);

        if (rows.length < reservations.count) {
            await getRows(rows.length);
        }
    }

    await getRows(0);

    // add header row
    rows.unshift(['reservationId'].concat(fields.concat(
        'money.nightlyOwnerRevenue',
        'checkIn.year',
        'checkIn.month',
        'checkIn.month.nights',
        'checkIn.month.ownerRevenue',
        'checkOut.year',
        'checkOut.month',
        'checkOut.month.nights',
        'checkOut.month.ownerRevenue',
        'money.adjusted.stateTaxes',
        'money.adjusted.countyTaxes',
        'money.adjusted.taxableGross',
        'money.adjusted.creditCardFees',
        'money.adjusted.insuranceFees',
        'money.adjusted.hostChannelFees'
    )));
    
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