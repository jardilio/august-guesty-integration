import * as actions from "./actions.mjs";
import { argv } from 'node:process';

const action = argv[2];

if (!action) console.error("You must provide an action to run!") && exit(1);
else if (typeof(actions[action]) != "function") console.error(`${action} is not a valid action!`) && exit(1);

actions[action]();