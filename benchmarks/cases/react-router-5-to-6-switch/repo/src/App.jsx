const React = require("react");
const { Switch, Route } = require("react-router-dom");

function App() {
  return (
    <Switch>
      <Route path="/" exact component={() => null} />
    </Switch>
  );
}
module.exports = { App };
