import JSONClient from "./json-client.mjs";

export default class GuestyClient extends JSONClient {

    #config;

    /**
     * 
     * @param {Object} config 
     * @param {string} config.username
     * @param {string} config.password
     * @param {string} config.accountId
     * @param {string} config.apiKey
     * @returns 
     */
     constructor(config) {
        super('https://app.guesty.com/api/v2/', {
            "accept": "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.9",
            "authorization": "Bearer undefined",
            "content-type": "application/json;charset=UTF-8",
            "sec-ch-ua": "\"Google Chrome\";v=\"107\", \"Chromium\";v=\"107\", \"Not=A?Brand\";v=\"24\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"macOS\"",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "cross-site",
            "Referer": "https://owneraccess.guestyowners.com/",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "G-Aid-Cs": "G-89C7E-9FB65-B6F69"
        });
        this.#config = config;
    }

    /**
     * Authenticate the current session
     * @returns 
     */
    async authenticate() {
        const response = await this.fetch("authenticate", {
            body: this.#config,
            headers: {authorization: "Bearer undefined"},
            method: "POST"
        });

        const json = await response.json();

        this.appendHeaders({
            authorization: `Bearer ${json.token}`
        });

        return json;
    }

    /**
     * Returns a list of calendar days with information about associated reservation details
     * @param {Object} params 
     * @param {string} params.listing - The listing to fetch for
     * @param {string} params.from - Start date in YYYY-MM-DD format (default today)
     * @param {string} params.to - End date in YYYY-MM-DD format (default 7 days from today)
     * @param {string} params.fields - Fields to return (default date+accountId+listingId+guest+status+note+price+currency+listing.prices.currency+reservationId+reservation+blocks+ownerReservation+ownerReservationId)
     * @returns 
     */
    async getCalendar(params) {
        const now = Date.now(),
              from = params.from || new Date().toISOString().split('T')[0],
              to = params.to || new Date(now + (86400000*7)).toISOString().split('T')[0],
              fields = params.fields || 'date+accountId+listingId+guest+status+note+price+currency+listing.prices.currency+reservationId+reservation+blocks+ownerReservation+ownerReservationId',
              listing = params.listing;

        const response = await this.fetch(`listings/${listing}/calendar?from=${from}&to=${to}&fields=${fields}`);

        return response.json();
    }

    /**
     * Returns reservation details, including guest information not available in calander object
     * @param {string} reservationId 
     * @returns 
     */
    async getReservation(reservationId) {
        const response = await this.fetch(`reservations/${reservationId}`);
        return response.json();
    }
}