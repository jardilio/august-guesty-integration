import JSONClient from "./json-client.mjs";

const HTML_HEADERS = {
    //"cookie": "",
    "content-type": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
};

export default class StreamlineClient extends JSONClient {

    #config;

    #processorId;

    #cookie = {};

    /**
     * 
     * @param {Object} config 
     * @param {string} config.email
     * @param {string} config.password
     * @param {number} config.unit_id
     * @returns 
     */
     constructor(config) {
        super('https://ownerx.streamlinevrs.com/api/', {
            "accept": "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            "priority": "u=1, i",
            "sec-ch-ua": "\"Google Chrome\";v=\"129\", \"Not=A?Brand\";v=\"8\", \"Chromium\";v=\"129\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"macOS\"",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "cookie": "",
            "Referer": "https://ownerx.streamlinevrs.com/login",
            "Referrer-Policy": "strict-origin-when-cross-origin"
        });
        this.#config = config;
    }

    /**
     * Sets cookie and XSRF token headers automatically
     * @param {String} url 
     * @param {Object} params 
     * @returns {Promise}
     */
    async fetch(url, params) {
        if (params && params.prefetch) {
            await this.fetch(params.prefetch, {headers: HTML_HEADERS});
            params.headers = params.headers || {};
            params.headers.Referer = params.prefetch;
        }

        const response = await super.fetch(url, params);

        if (response.headers.has("set-cookie")) {
            response.headers.raw()['set-cookie'].forEach(value => {
                const parts = value.split(';');
                const cookiePart = parts[0];
                const keyValue = cookiePart.split('=');
                this.#cookie[keyValue[0]] = keyValue[1];
            });
            this.appendHeaders({
                "cookie": Object.keys(this.#cookie).map(key => `${key}=${this.#cookie[key]}`).sort().join("; "),
                "x-xsrf-token": this.#cookie.XSRF_TOKEN,
                "content-type": "application/json"
            });
        }

        return response;
    }

    /**
     * Authenticate the current session
     * @returns 
     */
    async authenticate() {
        this.#cookie = {};

        const response = await this.fetch("authenticateProcessor", {
            prefetch: "https://ownerx.streamlinevrs.com/login",
            body: {
                methodName: "AuthenticateProcessorMobile",
                params: {
                    email: this.#config.email,
                    password: this.#config.password,
                    return_reservation_types_for_owner: "YES"
                }
            },
            method: "POST",
            headers: {
                "Referer": "https://ownerx.streamlinevrs.com/login"
            }
        });

        const json = await response.json();
        this.#processorId = json.data.processor.id;

        return json;
    }

    /**
     * Returns reservation details, including guest information not available in calander object
     * @param {string} reservationId 
     * @returns 
     */
    async getReservation(confirmation_id) {
        const response = await this.fetch("streamline", {
            body: {
                methodName: "GetReservationInfo",
                params: {
                    confirmation_id, 
                    owner_module: 1,
                    show_commission_information: 1,
                    return_additional_fields: 1
                },
            },
            method: "POST"
        });
        return response.json();
    }

    /**
     * Returns a list of reservation summaries
     * @param {Number} skip The number of reservations to skip from previous loads (pagination)
     * @param {Number} limit The number of reservations to pull in this request (pagination)
     * @param {Array} fields The fields to return in the reservation summary (default ['checkIn', 'checkOut', 'confirmationCode', 'guest.fullName', 'guest.phone'])
     * @param {Array} filters The filters to apply for searching reservations
     * @returns 
     */
    async getReservations(options) {//skip = 0, limit = 25, fields = null, filters = null) {
        const response = await this.fetch("streamline", {
            //prefetch: `https://ownerx.streamlinevrs.com/properties/${this.#config.unit_id}/reservations`,
            body: {
                methodName: "GetReservationsForOwner",
                params: Object.assign({}, {
                    unit_id: this.#config.unit_id, 
                    processor_id: this.#processorId,
                    show_all: 1,
                    show_cancelled: false,
                    show_commission_information: 1
                }, options)
            },
            method: "POST"
        });
        return response.json();
    }
}

/*
Login Request:
fetch("https://ownerx.streamlinevrs.com/api/authenticateProcessor", {
  "headers": {
    "accept": "application/json, text/plain, * /*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Google Chrome\";v=\"129\", \"Not=A?Brand\";v=\"8\", \"Chromium\";v=\"129\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "x-xsrf-token": "wtM9GdzV-mF4x0xalNIThVsvxGB3b9XgOy8A",
    "cookie": "_csrf=RbcLpIkYwNt6G_nyUb4l08A3; sid=s%3AnJTmC4VviScEG4rZvDtdHiH9LF5Glsbu.nQihgUXQSPpHA5fi%2FQHGUCb0svCwTsPj6%2BYawr%2F6HME; _cfuvid=c8sDGZYTtwcS2II4w0sQFePkDDWEOyX0qL1uOpyI1f4-1728733859106-0.0.1.1-604800000; XSRF_TOKEN=wtM9GdzV-mF4x0xalNIThVsvxGB3b9XgOy8A",
    "Referer": "https://ownerx.streamlinevrs.com/login",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  },
  "body": "{\"methodName\":\"AuthenticateProcessorMobile\",\"params\":{\"email\":\"jeff.ardilio@gmail.com\",\"password\":\"\",\"return_reservation_types_for_owner\":\"YES\"}}",
  "method": "POST"
});

Login Response:
{
    "data": {
        "result_id": 1,
        "message": {},
        "processor": {
            "id": 813341,
            "company_id": 3255,
            "first_name": "Jeff and Karen",
            "last_name": "Ardilio",
            "email": "jeff.ardilio@gmail.com",
            "housekeeper_type_id": 1,
            "housekeeper_vendor_id": {},
            "super_vendor": 0,
            "head_operator": 0,
            "maintenance_supervisor": 0,
            "inspector": {},
            "client_id": 32670319,
            "show_print": "yes",
            "create_work_orders": "no",
            "view_work_orders": "no",
            "token": null,
            "roles": {
                "role": {
                    "id": 3,
                    "name": "Owner"
                }
            }
        },
        "vendor_hourly_rate": 0,
        "company": {
            "id": 3255,
            "name": "Euphoria Vacation Homes LLC",
            "code": null,
            "contact_email": "info@euphoriavacationhomes.com",
            "website_url": "https://www.euphoriavacationhomes.com/",
            "address": "1775 US Highway 1 South",
            "city": "St. Augustine",
            "state_name": "FL",
            "country_name": "US",
            "toll_free_phone": {},
            "mobile_logo": "https://web.streamlinevrs.com/pmt_common/d_images/company_mobile_logo_3255.png",
            "owner_relations_email": {},
            "owner_relations_phone": {},
            "owner_relations_text": {}
        }
    }
}
*/

/*
Get User Request:
fetch("https://ownerx.streamlinevrs.com/api/getUser?initial=0", {
  "headers": {
    "accept": "application/json, text/plain, * /*",
    "accept-language": "en-US,en;q=0.9",
    "if-none-match": "W/\"f-p5q3BxzUpS2YWmsz1lZT0EKNXoE\"",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Google Chrome\";v=\"129\", \"Not=A?Brand\";v=\"8\", \"Chromium\";v=\"129\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "x-xsrf-token": "MqiDJlYh-VLbDkI2ty7xpDVsDU5dSz4vHwr8",
    "cookie": "_csrf=RbcLpIkYwNt6G_nyUb4l08A3; sid=s%3AnJTmC4VviScEG4rZvDtdHiH9LF5Glsbu.nQihgUXQSPpHA5fi%2FQHGUCb0svCwTsPj6%2BYawr%2F6HME; _cfuvid=c8sDGZYTtwcS2II4w0sQFePkDDWEOyX0qL1uOpyI1f4-1728733859106-0.0.1.1-604800000; XSRF_TOKEN=MqiDJlYh-VLbDkI2ty7xpDVsDU5dSz4vHwr8",
    "Referer": "https://ownerx.streamlinevrs.com/login",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  },
  "body": null,
  "method": "GET"
});

Get User Response: 
{
    "result_id": 1,
    "message": {},
    "processor": {
        "id": 813341,
        "company_id": 3255,
        "first_name": "Jeff and Karen",
        "last_name": "Ardilio",
        "email": "jeff.ardilio@gmail.com",
        "housekeeper_type_id": 1,
        "housekeeper_vendor_id": {},
        "super_vendor": 0,
        "head_operator": 0,
        "maintenance_supervisor": 0,
        "inspector": {},
        "client_id": 32670319,
        "show_print": "yes",
        "create_work_orders": "no",
        "view_work_orders": "no",
        "token": null,
        "roles": {
            "role": {
                "id": 3,
                "name": "Owner"
            }
        }
    },
    "vendor_hourly_rate": 0,
    "company": {
        "id": 3255,
        "name": "Euphoria Vacation Homes LLC",
        "code": null,
        "contact_email": "info@euphoriavacationhomes.com",
        "website_url": "https://www.euphoriavacationhomes.com/",
        "address": "1775 US Highway 1 South",
        "city": "St. Augustine",
        "state_name": "FL",
        "country_name": "US",
        "toll_free_phone": {},
        "mobile_logo": "https://web.streamlinevrs.com/pmt_common/d_images/company_mobile_logo_3255.png",
        "owner_relations_email": {},
        "owner_relations_phone": {},
        "owner_relations_text": {}
    }
}
 */

/*
Get Reservations Request:
fetch("https://ownerx.streamlinevrs.com/api/streamline", {
  "headers": {
    "accept": "application/json, text/plain, * /*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Google Chrome\";v=\"129\", \"Not=A?Brand\";v=\"8\", \"Chromium\";v=\"129\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "x-xsrf-token": "BoJpUNj4-E-D6KawkU86Ab0Au9w6CHQGmLKc",
    "cookie": "_csrf=RbcLpIkYwNt6G_nyUb4l08A3; sid=s%3AnJTmC4VviScEG4rZvDtdHiH9LF5Glsbu.nQihgUXQSPpHA5fi%2FQHGUCb0svCwTsPj6%2BYawr%2F6HME; _cfuvid=c8sDGZYTtwcS2II4w0sQFePkDDWEOyX0qL1uOpyI1f4-1728733859106-0.0.1.1-604800000; XSRF_TOKEN=BoJpUNj4-E-D6KawkU86Ab0Au9w6CHQGmLKc",
    "Referer": "https://ownerx.streamlinevrs.com/properties/854397/reservations",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  },
  "body": "{\"methodName\":\"GetReservationsForOwner\",\"params\":{\"unit_id\":854397,\"processor_id\":813341,\"show_all\":1,\"show_cancelled\":false,\"show_commission_information\":1}}",
  "method": "POST"
});

Get Reservations Response:
{
    "data": [
        {
            "id": 39964113,
            "confirmation_id": 2260,
            "reservation_hash": "fa1711d263111b374f0494594ee7bb70",
            "creation_date": "08/14/2024 19:54:18",
            "startdate": "08/06/2025",
            "enddate": "08/14/2025",
            "occupants": 2,
            "occupants_small": 1,
            "days_number": 8,
            "type_id": 1,
            "pets": 0,
            "type_name": "OWN",
            "type_description": "Owner Block",
            "status_name": "Modified",
            "madetype_name": "OWN",
            "first_name": "Jeff And Karen",
            "last_name": "A",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 0,
                "owner_commission_percent": 80,
                "owner_commission_amount": 0
            },
            "manage": 1
        },
        {
            "id": 39754206,
            "confirmation_id": 1575,
            "reservation_hash": "3541b279fce4cd3b4855cc2eb3236bbe",
            "creation_date": "08/15/2024 15:13:21",
            "startdate": "05/18/2025",
            "enddate": "05/25/2025",
            "occupants": 6,
            "occupants_small": 0,
            "days_number": 7,
            "type_id": 4,
            "pets": 0,
            "type_name": "NPG",
            "type_description": "Non-Paying Guest of Owner",
            "status_name": "Booked",
            "madetype_name": "ADM",
            "first_name": "Karen",
            "last_name": "A",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 0,
                "owner_commission_percent": 80,
                "owner_commission_amount": 0
            },
            "manage": 0
        },
        {
            "id": 40181140,
            "confirmation_id": 2594,
            "reservation_hash": "95951c8176ef870d88c6deb802dc46ec",
            "creation_date": "09/02/2024 20:57:45",
            "startdate": "04/12/2025",
            "enddate": "04/20/2025",
            "occupants": 2,
            "occupants_small": 1,
            "days_number": 8,
            "type_id": 1,
            "pets": 0,
            "type_name": "OWN",
            "type_description": "Owner Block",
            "status_name": "Booked",
            "madetype_name": "OWN",
            "first_name": "Jeff And Karen",
            "last_name": "A",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 0,
                "owner_commission_percent": 80,
                "owner_commission_amount": 0
            },
            "manage": 1
        },
        {
            "id": 40391244,
            "confirmation_id": 2778,
            "reservation_hash": "16fe35140d3c812f09277b3e3bf34fba",
            "creation_date": "09/21/2024 19:25:26",
            "startdate": "12/27/2024",
            "enddate": "01/01/2025",
            "occupants": 6,
            "occupants_small": 1,
            "days_number": 5,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Booked",
            "madetype_name": "WSR",
            "first_name": "Emily",
            "last_name": "B",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 332.97,
                "owner_commission_percent": 80,
                "owner_commission_amount": 1331.89
            },
            "manage": 0
        },
        {
            "id": 39344040,
            "confirmation_id": 1146,
            "reservation_hash": "becd7f43b5004fe089acc164d2b2ef77",
            "creation_date": "06/24/2024 18:57:22",
            "startdate": "11/21/2024",
            "enddate": "11/30/2024",
            "occupants": 1,
            "occupants_small": 0,
            "days_number": 9,
            "type_id": 1,
            "pets": 0,
            "type_name": "OWN",
            "type_description": "Owner Block",
            "status_name": "Booked",
            "madetype_name": "ADM",
            "first_name": "Jeff And Karen",
            "last_name": "A",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 0,
                "owner_commission_percent": 80,
                "owner_commission_amount": 0
            },
            "manage": 1
        },
        {
            "id": 39848167,
            "confirmation_id": 2038,
            "reservation_hash": "06c911fffc7745556a526483e9df4ab4",
            "creation_date": "08/05/2024 19:19:40",
            "startdate": "11/17/2024",
            "enddate": "11/21/2024",
            "occupants": 3,
            "occupants_small": 0,
            "days_number": 4,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Booked",
            "madetype_name": "WSR",
            "first_name": "Barbara",
            "last_name": "O",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 112.68,
                "owner_commission_percent": 80,
                "owner_commission_amount": 450.74
            },
            "manage": 0
        },
        {
            "id": 40316608,
            "confirmation_id": 2699,
            "reservation_hash": "0893904888d48d78508fda375c9c5782",
            "creation_date": "09/14/2024 15:44:45",
            "startdate": "11/08/2024",
            "enddate": "11/11/2024",
            "occupants": 4,
            "occupants_small": 0,
            "days_number": 3,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Booked",
            "madetype_name": "WSR",
            "first_name": "Amber",
            "last_name": "G",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 104.86,
                "owner_commission_percent": 80,
                "owner_commission_amount": 419.44
            },
            "manage": 0
        },
        {
            "id": 39847740,
            "confirmation_id": 1997,
            "reservation_hash": "d5195b09387975ea34f0b4d41646c6bd",
            "creation_date": "08/05/2024 18:40:21",
            "startdate": "10/24/2024",
            "enddate": "10/28/2024",
            "occupants": 5,
            "occupants_small": 0,
            "days_number": 4,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Booked",
            "madetype_name": "WSR",
            "first_name": "Erwin",
            "last_name": "R",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 122.43,
                "owner_commission_percent": 80,
                "owner_commission_amount": 489.72
            },
            "manage": 0
        },
        {
            "id": 39847710,
            "confirmation_id": 1989,
            "reservation_hash": "25d307149fbf2a214ec36e1fb24a894f",
            "creation_date": "08/05/2024 18:37:06",
            "startdate": "10/18/2024",
            "enddate": "10/23/2024",
            "occupants": 4,
            "occupants_small": 1,
            "days_number": 5,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Booked",
            "madetype_name": "WSR",
            "first_name": "William",
            "last_name": "A",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 150.42,
                "owner_commission_percent": 80,
                "owner_commission_amount": 601.67
            },
            "manage": 0
        },
        {
            "id": 39847531,
            "confirmation_id": 1975,
            "reservation_hash": "683f8f73796fa5bcf159488f091ff446",
            "creation_date": "08/05/2024 18:18:14",
            "startdate": "10/06/2024",
            "enddate": "10/10/2024",
            "occupants": 3,
            "occupants_small": 3,
            "days_number": 4,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Checked Out",
            "madetype_name": "WSR",
            "first_name": "Samantha",
            "last_name": "S",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 117.56,
                "owner_commission_percent": 80,
                "owner_commission_amount": 470.22
            },
            "manage": 0
        },
        {
            "id": 40420009,
            "confirmation_id": 2816,
            "reservation_hash": "104269496cc9679c92bcd9e27c0cf34a",
            "creation_date": "09/24/2024 19:24:15",
            "startdate": "09/27/2024",
            "enddate": "09/30/2024",
            "occupants": 5,
            "occupants_small": 0,
            "days_number": 3,
            "type_id": 572,
            "pets": 0,
            "type_name": "SC-Booking.com",
            "type_description": "SC-Booking.com",
            "status_name": "Checked Out",
            "madetype_name": "PDWTA",
            "first_name": "Angela",
            "last_name": "B",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 51.98,
                "owner_commission_percent": 80,
                "owner_commission_amount": 207.91,
                "travel_agent_commission_percent": 25.5609,
                "travel_agent_commission_amount": 111.76
            },
            "manage": 0
        },
        {
            "id": 39846995,
            "confirmation_id": 1937,
            "reservation_hash": "fe0585f1151ef38f29d9f4835ba8878e",
            "creation_date": "08/05/2024 17:38:00",
            "startdate": "09/21/2024",
            "enddate": "09/24/2024",
            "occupants": 3,
            "occupants_small": 1,
            "days_number": 3,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Checked Out",
            "madetype_name": "WSR",
            "first_name": "Christine",
            "last_name": "C",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 102.84,
                "owner_commission_percent": 80,
                "owner_commission_amount": 411.34
            },
            "manage": 0
        },
        {
            "id": 39960678,
            "confirmation_id": 2244,
            "reservation_hash": "dbde55169f4f7ff1124c8eb6555a1898",
            "creation_date": "08/14/2024 15:29:59",
            "startdate": "08/31/2024",
            "enddate": "09/06/2024",
            "occupants": 3,
            "occupants_small": 2,
            "days_number": 6,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Checked Out",
            "madetype_name": "WSR",
            "first_name": "Danita",
            "last_name": "Q",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 188.46,
                "owner_commission_percent": 80,
                "owner_commission_amount": 753.85
            },
            "manage": 0
        },
        {
            "id": 39820573,
            "confirmation_id": 1824,
            "reservation_hash": "d3e2752d7b4704384ea111f97012c525",
            "creation_date": "08/03/2024 22:23:45",
            "startdate": "08/24/2024",
            "enddate": "08/31/2024",
            "occupants": 6,
            "occupants_small": 2,
            "days_number": 7,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Checked Out",
            "madetype_name": "WSR",
            "first_name": "Chelsea",
            "last_name": "W",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 219.28,
                "owner_commission_percent": 80,
                "owner_commission_amount": 877.11
            },
            "manage": 0
        },
        {
            "id": 39820496,
            "confirmation_id": 1810,
            "reservation_hash": "46c76b4373bcd8990b290f9a0a4ea339",
            "creation_date": "08/03/2024 22:14:59",
            "startdate": "08/18/2024",
            "enddate": "08/24/2024",
            "occupants": 7,
            "occupants_small": 0,
            "days_number": 6,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Checked Out",
            "madetype_name": "WSR",
            "first_name": "Caitlin",
            "last_name": "W",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 181.39,
                "owner_commission_percent": 80,
                "owner_commission_amount": 725.56
            },
            "manage": 0
        },
        {
            "id": 39817184,
            "confirmation_id": 1733,
            "reservation_hash": "983da75acd96ecdf8b4c78f422afa083",
            "creation_date": "08/03/2024 15:17:36",
            "startdate": "08/08/2024",
            "enddate": "08/13/2024",
            "occupants": 2,
            "occupants_small": 3,
            "days_number": 5,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Checked Out",
            "madetype_name": "WSR",
            "first_name": "Victor",
            "last_name": "G",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 229.66,
                "owner_commission_percent": 80,
                "owner_commission_amount": 918.62
            },
            "manage": 0
        },
        {
            "id": 39660160,
            "confirmation_id": 1505,
            "reservation_hash": "2e2692fbbb29f312b0476ce7d1f5db73",
            "creation_date": "07/22/2024 12:50:48",
            "startdate": "08/04/2024",
            "enddate": "08/08/2024",
            "occupants": 1,
            "occupants_small": 0,
            "days_number": 4,
            "type_id": 2,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Checked Out",
            "madetype_name": "ADM",
            "first_name": "Erica",
            "last_name": "M",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 183.78,
                "owner_commission_percent": 80,
                "owner_commission_amount": 735.12
            },
            "manage": 0
        },
        {
            "id": 39867531,
            "confirmation_id": 2140,
            "reservation_hash": "185071b36d41ef86d44dddb63e3cbb4d",
            "creation_date": "08/07/2024 14:24:37",
            "startdate": "07/27/2024",
            "enddate": "08/03/2024",
            "occupants": 6,
            "occupants_small": 2,
            "days_number": 7,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Checked Out",
            "madetype_name": "WSR",
            "first_name": "Mandy",
            "last_name": "G",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 323.2,
                "owner_commission_percent": 80,
                "owner_commission_amount": 1292.82
            },
            "manage": 0
        },
        {
            "id": 39322866,
            "confirmation_id": 1038,
            "reservation_hash": "6653d4863e6b1139f037b62823fd74c1",
            "creation_date": "06/22/2024 19:44:06",
            "startdate": "07/20/2024",
            "enddate": "07/26/2024",
            "occupants": 5,
            "occupants_small": 3,
            "days_number": 6,
            "type_id": 16,
            "pets": 0,
            "type_name": "HAFamL",
            "type_description": "HAFamL",
            "status_name": "Checked Out",
            "madetype_name": "ADM",
            "first_name": "Amie",
            "last_name": "L",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 511.4,
                "owner_commission_percent": 80,
                "owner_commission_amount": 2045.6
            },
            "manage": 0
        },
        {
            "id": 39308297,
            "confirmation_id": 965,
            "reservation_hash": "16cc1ff8b08e3a270520e31bdbea3d1e",
            "creation_date": "06/21/2024 13:54:23",
            "startdate": "07/15/2024",
            "enddate": "07/18/2024",
            "occupants": 2,
            "occupants_small": 2,
            "days_number": 3,
            "type_id": 16,
            "pets": 0,
            "type_name": "HAFamL",
            "type_description": "HAFamL",
            "status_name": "Checked Out",
            "madetype_name": "ADM",
            "first_name": "Json",
            "last_name": "H",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 217.2,
                "owner_commission_percent": 80,
                "owner_commission_amount": 868.8
            },
            "manage": 0
        },
        {
            "id": 39819972,
            "confirmation_id": 1792,
            "reservation_hash": "741e440db0aa333d170e65ba27979222",
            "creation_date": "08/03/2024 20:47:11",
            "startdate": "07/09/2024",
            "enddate": "07/14/2024",
            "occupants": 5,
            "occupants_small": 2,
            "days_number": 5,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Checked Out",
            "madetype_name": "WSR",
            "first_name": "Keyna",
            "last_name": "H",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 311.69,
                "owner_commission_percent": 80,
                "owner_commission_amount": 1246.77
            },
            "manage": 0
        },
        {
            "id": 39820100,
            "confirmation_id": 1802,
            "reservation_hash": "af87fce9f743dc36aa95278edd4179c3",
            "creation_date": "08/03/2024 21:03:20",
            "startdate": "07/05/2024",
            "enddate": "07/08/2024",
            "occupants": 8,
            "occupants_small": 0,
            "days_number": 3,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Checked Out",
            "madetype_name": "WSR",
            "first_name": "Garth",
            "last_name": "P",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 180.15,
                "owner_commission_percent": 80,
                "owner_commission_amount": 720.59
            },
            "manage": 0
        },
        {
            "id": 39960205,
            "confirmation_id": 2232,
            "reservation_hash": "737048e77b1584aaf3aac41f02d29a47",
            "creation_date": "08/14/2024 15:02:36",
            "startdate": "07/01/2024",
            "enddate": "07/05/2024",
            "occupants": 1,
            "occupants_small": 0,
            "days_number": 4,
            "type_id": 236,
            "pets": 0,
            "type_name": "STA",
            "type_description": "Standard",
            "status_name": "Checked Out",
            "madetype_name": "ADM",
            "first_name": "Jill",
            "last_name": "D",
            "commission_information": {
                "management_commission_percent": 20,
                "management_commission_amount": 409.2,
                "owner_commission_percent": 80,
                "owner_commission_amount": 1636.82
            },
            "manage": 0
        }
    ]
}
*/

/*
Get Reservation Request:

fetch("https://ownerx.streamlinevrs.com/api/streamline", {
  "headers": {
    "accept": "application/json, text/plain, * /*",
    "accept-language": "en-US,en;q=0.9",
    "content-type": "application/json",
    "priority": "u=1, i",
    "sec-ch-ua": "\"Google Chrome\";v=\"129\", \"Not=A?Brand\";v=\"8\", \"Chromium\";v=\"129\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "x-xsrf-token": "14JUNOZ2-PLnnXvfa4RMA-auNl9hNFv8BVGM",
    "cookie": "_csrf=RbcLpIkYwNt6G_nyUb4l08A3; _cfuvid=c8sDGZYTtwcS2II4w0sQFePkDDWEOyX0qL1uOpyI1f4-1728733859106-0.0.1.1-604800000; sid=s%3AsDP1j-PuwaSAjoqgLcF3TmCnmzIB8nir.IvKC8vtG3Uem1wsb6xgRbDthUq1XmQP5CIlaPUF0WKk; XSRF_TOKEN=14JUNOZ2-PLnnXvfa4RMA-auNl9hNFv8BVGM",
    "Referer": "https://ownerx.streamlinevrs.com/properties/854397/reservations/2244",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  },
  "body": "{\"methodName\":\"GetReservationInfo\",\"params\":{\"confirmation_id\":2244,\"show_commission_information\":1,\"return_additional_fields\":1,\"owner_module\":1}}",
  "method": "POST"
});

Get Reservation Response: 
{
    "data": {
        "reservation": {
            "id": 39960678,
            "confirmation_id": 2244,
            "madetype_id": 7,
            "cross_reference_code": "HMFCNPSXTM",
            "tax_exempt": 0,
            "hash": "dbde55169f4f7ff1124c8eb6555a1898",
            "pricing_model": 1,
            "client_id": 32754234,
            "creation_date": "08/14/2024 15:29:59",
            "startdate": "08/31/2024",
            "enddate": "09/06/2024",
            "occupants": 3,
            "occupants_small": 2,
            "pets": 0,
            "email": "Danita2022@yahoo.com",
            "email1": {},
            "email2": {},
            "title": {},
            "first_name": "Danita",
            "middle_name": {},
            "last_name": "Queener",
            "address": {},
            "address2": {},
            "city": {},
            "zip": {},
            "country_id": 227,
            "state_id": {},
            "phone": "+1 (615) 476-0967",
            "fax": {},
            "mobile_phone": "+1 (615) 476-0967",
            "work_phone": "+1 (615) 476-0967",
            "client_comments": {},
            "days_number": 6,
            "maketype_name": "NW",
            "maketype_description": "Wholesale Reservation",
            "type_name": "SC-ABnB",
            "status_code": 8,
            "location_id": 825302,
            "condo_type_id": 822803,
            "coupon_id": {},
            "unit_id": 854397,
            "longterm_enabled": 1,
            "unit_name": "CR 3306",
            "unit_code": "CR 3306",
            "location_name": "CR 3306",
            "lodging_type_id": 3,
            "condo_type_name": "Default CR 3306",
            "country_name": "US",
            "state_name": {},
            "price_nightly": 991.91,
            "price_total": 1356.64,
            "price_paidsum": 1356.64,
            "price_common": 1356.64,
            "price_balance": 0,
            "coupon_code": {},
            "company_id": 3255,
            "status_id": 5,
            "hear_about_name": "Airbnb",
            "last_updated": "09/06/2024 10:25:19.894832 EDT",
            "commissioned_agent_name": {},
            "travelagent_name": "Streamline Connect AirBnB (OFFICIAL)",
            "parent_id": {},
            "type_id": 236,
            "maketype_id": 7,
            "owning_id": 915566,
            "multi_payment_account_id": {},
            "travelagent_id": 811976,
            "lead_status_id": 5,
            "check_in_time": "4:00 PM",
            "check_out_time": "10:00 AM",
            "additional_fields": {
                "additional_field": {
                    "name": "Vehicle Information",
                    "value": {}
                }
            }
        },
        "commission_information": {
            "management_commission_amount": 188.46,
            "management_commission_percent": 20,
            "owner_commission_amount": 753.85,
            "owner_commission_percent": 80,
            "owner_commission_disburse_date": [
                "08/31/2024",
                "09/07/2024"
            ],
            "management_commission_disburse_date": [
                "08/31/2024",
                "09/07/2024"
            ],
            "travel_agent_commission_disburse_date": {}
        }
    }
}
*/