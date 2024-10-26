import fetch from 'node-fetch'
import { URL } from 'node:url';

export class HttpResponseError extends Error {
    #response;

    constructor(message, response) {
        super(message);
        this.#response = response;
    }

    response() {
        return this.#response;
    }
}

export default class JSONClient {

    #uri;
    #headers;

    /**
     * 
     * @param {string} uri 
     * @param {Object} headers 
     */
    constructor(uri = '', headers = {}) {
        this.#headers = headers;
        this.#uri = uri;
    }

    /**
     * 
     * @param {Object} headers 
     */
    appendHeaders(headers) {
        Object.assign(this.#headers, headers);
    }

    /**
     * 
     * @param {string} url 
     * @param {Object} params 
     * @param {string} params.body 
     * @param {string} params.headers 
     * @param {string} params.method
     * @returns 
     */
     async fetch(url, params) {
        url = new URL(url.toString(), this.#uri).href;
        params = Object.assign(
            {},
            params,
            {headers: Object.assign(
                this.#headers,
                params && params.headers || {}
            )} 
        );

        if (params.body && typeof(params.body) != 'string') {
            params.body = JSON.stringify(params.body);
        }

        //console.debug("[REQUEST]", url, params);
        const response = await fetch(url, params);

        if (response.status >= 400) {
            const body = await response.text();
            throw new HttpResponseError(`Received unexpected status code: ${response.status}!\n${body}`, response);
        }

        return response;
    }
}