import JSONClient from "./json-client.mjs";

export default class AugustClient extends JSONClient {

    #config
    #userId

    /**
     * 
     * @param {Object} config 
     * @param {string} config.installId
     * @param {string} config.password
     * @param {string} config.identifier
     * @param {string} config.apiKey
     * @returns 
     */
     constructor(config) {
        super('https://api-production.august.com/', {
            'x-august-api-key': config.apiKey,
            'x-kease-api-key': config.apiKey,
            'Content-Type': 'application/json',
            'Accept-Version': '0.0.1',
            'User-Agent': 'August/Luna-3.2.2'
        });
        this.#config = config;
    }

    /**
     * Starts the MFA validation for the given API KEY and Installation ID
     * with an valid username and password. First stage generates a code to 
     * email/phone, second stage takes in that code to complete validation.
     * @param {string} code 
     * @returns 
     */
    async validate(code = null) {
        const idType = this.#config.identifier.split(':')[0];
        const idValue = this.#config.identifier.split(':')[1];
        const body = code ? { code, [idType]: idValue } : { value: idValue };
        const endpoint = code ? 'validate' : 'validation';
        const response = await this.fetch(`${endpoint}/${idType}`, {
            method: "POST",
            body
        });

        const token = response.headers.get('x-august-access-token');
        if (token) {
            this.appendHeaders({
                "x-august-access-token": token
            });
        }

        return response.text();
    }

    /**
     * Refreshes the current session as tokens can expire. Requires pre-validation
     * of existing Installation ID and API Key combination.
     * @returns 
     */
    async session() {
        const {installId, password, identifier} = this.#config;
        const response = await this.fetch("session", {
            body: { installId, password, identifier },
            method: "POST"
        });

        this.appendHeaders({
            "x-august-access-token": response.headers.get('x-august-access-token')
        });

        const session = await response.json();
        this.#userId = session.userId;

        return session;
    }

    /**
     * Returns a list of pins already linked to a given lock id
     * @param {String} lock 
     * @returns 
     */
    async getLockPins(lock) {
        const response = await this.fetch(`locks/${lock}/pins`);
        return response.json();
    }

    /**
     * Generates a temporary guest access code for a given user
     * @param {Object} params 
     * @param {string} params.firstName
     * @param {string} params.lastName
     * @param {string} params.pin
     * @param {string} params.lockID
     * @param {Date} params.accessStartTime
     * @param {Date} params.accessEndTime
     * @returns 
     */
    async createGuestEntryPin(params) {
        let response;

        response = await this.fetch('unverifiedusers', {
            method: 'POST',
            body: {
                firstName: params.firstName,
                lastName: params.lastName,
                lockID: params.lockID,
                pin: params.pin
            }
        });

        const user = await response.json();
        response = await this.fetch(`locks/${params.lockID}/pins`, {
            method: "POST",
            body: {
                commands: [{
                    action: 'load',
                    pin: params.pin,
                    accessType: 'temporary',
                    accessTimes: `DTSTART=${params.accessStartTime.toISOString()};DTEND=${params.accessEndTime.toISOString()}`,
                    augustUserID: user.id
                }]
            }
        });

        let loaded = false, match;
        while (!loaded) {
            const pins = await(await this.fetch(`/locks/${params.lockID}/pins`)).json();
            match = []
                .concat(pins.created,pins.loaded,pins.disabled,pins.disabling,pins.enabling,pins.deleting,pins.updating)
                .find(r => r.userID == user.id);

            const state = match ? match.state : 'missing';
            
            switch(state) {
                case 'loaded':
                    return match;
                case 'created':
                case 'creating':
                case 'enabled':
                case 'enabling':
                    console.debug(`Waiting...user ${user.id} is still in the ${state} state.`);
                    await new Promise(r => setTimeout(r, 30000));
                    break;
                default:
                    console.log(match, pins);
                    throw new Error(`User ${user.id} is in the unexpected ${state} state!`);
                    break;
            }
        }
    }
}
