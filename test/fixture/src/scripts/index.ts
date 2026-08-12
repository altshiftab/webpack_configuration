import "../styles/main.css";

type TemplateTag = (strings: TemplateStringsArray, ...values: unknown[]) => string;

const joinTemplate: TemplateTag = (strings, ...values) =>
    strings.reduce((out, part, i) => out + part + String(values[i] ?? ""), "");

const css: TemplateTag = joinTemplate;
const html: TemplateTag = joinTemplate;

const styles = css`
  .lit-element {
    color: red;
  }
`;

const template = html`
  <div>
    Fixture content
  </div>
`;

console.log("fixture-entry", styles, template);
