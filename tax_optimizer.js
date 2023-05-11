
class Bracket {
  max_payment = 0;
  prev = null;

  constructor(percent, top) {
    this.percent = percent
    this.top = top
  }

  toString() {
    return "percent=${this.percent} top=${this.top} max=${this.max_payment}";
  }
}

class TaxSituation {
  // Fields are a list of brackets with 0 being Bracket(0, 0)
  income_brackets;
  capital_gains_brackets;

  constructor(income_brackets, capital_gains_brackets) {
    this.income_brackets = income_brackets;
    this.capital_gains_brackets = capital_gains_brackets;

    function fill_prev_and_max(brackets) {
      for (let i = 1; i < brackets.length; ++i) {
        const bracket = brackets[i]
        bracket.prev = brackets[i-1]
        bracket.max_payment = bracket.prev.max_payment + (
          bracket.percent / 100 * (bracket.top - bracket.prev.top)
        )
      }
    }

    fill_prev_and_max(this.income_brackets)
    fill_prev_and_max(this.capital_gains_brackets)
  }

  calculateIncomeTax(income) {
    if (income == 0) return 0

    for (const bracket of self.income_brackets) {
      if (income <= bracket.top) {
        return (income - bracket.prev.top) * bracket.percent / 100 +
               bracket.prev.max_payment;
      }
    }
    assert("should never get here");
  }

  calculateCapitalGainsTax(income, capital_gains) {
    let result = 0;
    for (const bracket of self.capital_gains_brackets) {
      if (capital_gains <= 0) { break; }

      if (income <= bracket.top) {
        const remaining_in_bracket = bracket.top - income;
        income = 0;  // we use up all the income on the first round.
        const gains_in_this_bracket = Math.min(capital_gains, remaining_in_bracket);
        capital_gains -= gains_in_this_bracket;
        result += gains_in_this_bracket * bracket.percent / 100;
      }
    }

    return result;
  }
}

const g_situations = {
  "married_filing_jointly": new TaxSituation(
    // https://www.nerdwallet.com/article/taxes/federal-income-tax-brackets
    income_brackets = [
      new Bracket(0,	0),
      new Bracket(10,	20550),
      new Bracket(12,	83550),
      new Bracket(22,	178150),
      new Bracket(24,	340100),
      new Bracket(32,	431900),
      new Bracket(35,	647850),
      new Bracket(37,	Infinity),
    ],
    // https://www.nerdwallet.com/article/taxes/capital-gains-tax-rates
    capital_gains_brackets = [
      new Bracket(0, 0),
      new Bracket(0, 83550),
      new Bracket(15, 517200),
      new Bracket(20, Infinity),
    ],
  ),
};

class SavedState {
  min_income;
  max_income;
  min_investment;
  max_investment;
}

const g_inputNames = ["min_income", "max_income",
                      "min_investment", "max_investment",
                      "investment_gain_percent",
                      "min_spend", "max_spend"];

class TaxOptimizer extends HTMLElement {
  situationName = null;

  constructor() {
    super();
  }

  connectedCallback() {
    const rootDiv = document.getElementById("tax_optimizer_template").content.cloneNode(true);

    // React to window resizing.
    this.prevHeight = window.innerHeight;
    this.prevWidth = window.innerWidth;
    window.addEventListener('resize', this.handleWindowResize.bind(this));

    { // Settings box handling
      this.settingsExpanded = true;
      this.settingsHeader = rootDiv.querySelector(".settings > header");
      this.settingsHeader.addEventListener('click', this.handleSettingsHeaderClick.bind(this));
      this.settingsApplyButton = rootDiv.querySelector(".settings #apply button");
      this.settingsApplyButton.addEventListener('click', this.handleApplyClick.bind(this));

      // Setup input boxes with saved state and event listeners.
      try {
        this.savedState = JSON.parse(localStorage.getItem("state"));
      } catch(e) {
        localStorage.clear();
        this.savedState = new SavedState();
      }
      for (const inputName of g_inputNames) {
        rootDiv.querySelector(`#${inputName} input`)
            .addEventListener('keydown', this.handleKey.bind(this));

        if (this.savedState?.[inputName] != null) {
          rootDiv.querySelector(`#${inputName} input`).value =
              this.savedState[inputName];
        }
      }
    }

    this.appendChild(rootDiv);
    this.run();
  }

  handleWindowResize(e) {
    // Ignore insignificant changes.
    if (Math.abs(this.prevHeight - window.innerHeight) / window.innerHeight < 0.15 &&
        Math.abs(this.prevWidth - window.innerWidth) / window.innerWidth < 0.15) {
      return;
    }
    this.prevHeight = window.innerHeight;
    this.prevWidth = window.innerWidth;
    this.run();
  }

  handleApplyClick() {
    // Save state to storage.
    const ss = new SavedState();
    for (const inputName of g_inputNames) {
      ss[inputName] = this.querySelector(`#${inputName} input`).value;
    }
    localStorage.setItem("state", JSON.stringify(ss));

    this.run();
  }

  handleKey(e) {
    if (e.code == "Enter") { this.handleApplyClick(); }
  }

  getInput(id) {
    return this.querySelector(`#${id} input`);
  }

  handleSettingsHeaderClick(e) {
    if (this.settingsExpanded) {
      this.querySelector(".settings main").classList.add("hidden");
      this.querySelector(".settings main").classList.remove("shown");
      this.settingsHeader.classList.add("collapsed");
      this.settingsHeader.classList.remove("expanded");
    } else {
      this.querySelector(".settings main").classList.add("shown");
      this.querySelector(".settings main").classList.remove("hidden");
      this.settingsHeader.classList.add("expanded");
      this.settingsHeader.classList.remove("collapsed");
    }
    this.settingsExpanded = !this.settingsExpanded;
  }

  run() {
    this.querySelector("#dimOverlay").classList.remove("hidden");
    this.querySelector("#dimOverlay").classList.add("shown");
    self.scheduler.postTask(this.runAsync.bind(this), {
      priority: "background",
      delay: 10,  // Give time for the "Loading" screen to actuall appear.
                  // TODO(ux): better solution like web workers.
    });
  }

  runAsync() {
    console.log("starting runAsync");

    let situationName = this.querySelector("#situation_select").value;
    let situation = g_situations[situationName];
    if (situation === undefined) {
      alert(`ERROR! unknown situation name: ${situationName}`);
      // TODO: shadow out the results area since it's not correctly reflecting
      // the input.  Rather it's the old input.
      return;
    }

    let incomeEffectiveRate = {
      x: [],
      y: [],
      type: 'scatter',
      mode: 'lines',
    };
    let effectiveRateSurface = {
      type: "surface",
      x: [],
      y: [],
      z: [],
      hovertemplate: "Income: %{y}<br>" +
                     "Capital Gains: %{x}<br>" +
                     "Effective % Tax: %{z}<br>" +
                     "<extra></extra>",
      contours: {
        x: { show: true, highlightcolor: "#ffff80" },
        z: { show: true, highlightcolor: "#ffff80" },
      },
    };
    let takeHomeSurface = {
      type: "surface",
      x: [],
      y: [],
      z: [],
      hovertemplate: "Income: %{y}<br>" +
                     "Capital Gains: %{x}<br>" +
                     "Take Home: %{z}<br>" +
                     "<extra></extra>",
    };
    let layout_common = {
      autosize: true,
      height: Math.min(window.innerWidth * 1.2,
                       window.innerHeight * 0.9),
    };

    const max_income = this.getInput("max_income").value;
    const min_income = Math.min(max_income, this.getInput("min_income").value);
    const max_investment = this.getInput("max_investment").value;
    const min_investment = Math.min(max_investment,
                                    this.getInput("min_investment").value);
    const investment_gain_percent = Math.min(100, Math.max(0,
        this.getInput("investment_gain_percent").value));
    const max_spend = this.getInput("max_spend").value;
    const min_spend = Math.min(max_spend, this.getInput("min_spend").value);

    const resolution = 1000.0;

    let income_axis = [];
    let investment_axis = [];
    for (let investment = min_investment; investment <= max_investment;
         investment += (max_investment - min_investment) / resolution) {
      investment_axis.push(investment);
    }

    for (let income = min_income; income <= max_income;
         income += (max_income - min_income) / resolution) {
      const income_tax = situation.calculateIncomeTax(income);

      // Preapre effective income tax rate line graph.
      incomeEffectiveRate.x.push(Math.round(
          income / 1000) * 1000);
      incomeEffectiveRate.y.push(Math.round(
          income_tax / income * 100 * 100) / 100);

      // Prepare surfaces.
      income_axis.push(income);
      let effectiveRateRow = [];
      let takeHomeRow = [];
      for (const investment of investment_axis) {
        const total_tax = income_tax +
            situation.calculateCapitalGainsTax(
                income, investment * investment_gain_percent / 100);
        const total_income = income + investment;
        if (total_income <= max_spend && total_income >= min_spend) {
          effectiveRateRow.push(100 * total_tax / total_income);
          takeHomeRow.push(total_income - total_tax);
        } else {
          effectiveRateRow.push(null);
          takeHomeRow.push(null);
        }
      }
      effectiveRateSurface.z.push(effectiveRateRow);
      takeHomeSurface.z.push(takeHomeRow);
    }

    effectiveRateSurface.x = investment_axis;
    effectiveRateSurface.y = income_axis;
    takeHomeSurface.x = investment_axis;
    takeHomeSurface.y = income_axis;

    function merge(orig, more) {
      return Object.assign(JSON.parse(JSON.stringify(layout_common)), more);
    }

    console.log("plotting 1");

    /*
    Plotly.newPlot(
      this.querySelector("#effectiveIncomeTaxChart > div.chart"),
      [incomeEffectiveRate],
      merge(layout_common, {
        title: this.querySelector("#effectiveIncomeTaxChart > label").innerHTML,
        scene: {
          xaxis: { title: "Income" },
          yaxis: { title: "Effective Income Tax Rate" },
        },
      }),
    );
    */

    Plotly.newPlot(
      this.querySelector("#effectiveRateChart > div.chart"),
      [effectiveRateSurface],
      merge(layout_common, {
        title: this.querySelector("#effectiveRateChart > label").innerHTML,
        scene: {
          xaxis: { title: "Capital Gains" },
          yaxis: { title: "Income" },
          zaxis: {
            title: "Effective Tax Percentage",
            range: [0, effectiveRateSurface.z.flat().reduce((x,y) => Math.max(x,y))],
          },
          camera: {
            eye: {
              x: -1.25,
              y: -1.25,
              z: 0.1,
            },
          },
        }
      }),
    );

    Plotly.newPlot(
      this.querySelector("#takeHomeChart > div.chart"),
      [takeHomeSurface],
      merge(layout_common, {
        title: this.querySelector("#takeHomeChart > label").innerHTML,
        scene: {
          xaxis: { title: "Capital Gains" },
          yaxis: { title: "Income" },
          zaxis: {
            title: "Take Home",
            //range: [0, spend * 1.2],
            //rangemode: "tozero",
          },
        }
      }),
    );

    this.querySelector("#dimOverlay").classList.add("hidden");
    this.querySelector("#dimOverlay").classList.remove("shown");
    console.log("finally done");
  }
}

customElements.define('tax-optimizer', TaxOptimizer);

