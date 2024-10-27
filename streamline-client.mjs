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