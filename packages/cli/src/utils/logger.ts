import { cyan, green, red, yellow } from "kolorist";

export const logger = {
  info(message: string) {
    console.log(cyan("info"), message);
  },
  success(message: string) {
    console.log(green("done"), message);
  },
  warn(message: string) {
    console.log(yellow("warn"), message);
  },
  error(message: string) {
    console.error(red("error"), message);
  },
};
