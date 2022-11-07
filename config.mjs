import { config } from 'dotenv';

config();

export const {
    GUESTY_USERNAME,
    GUESTY_PASSWORD,
    GUESTY_LISTING,
    GUESTY_ACCOUNT,
    GUESTY_API_KEY,
    AUGUST_INSTALL_ID,
    AUGUST_PASSWORD,
    AUGUST_IDENTIFIER,
    AUGUST_API_KEY,
    AUGUST_LOCK
} = process.env;