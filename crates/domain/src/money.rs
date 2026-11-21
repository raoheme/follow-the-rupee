//! Money is stored as integer paise only. Rupee text is derived for display and never persisted.
use serde::{Deserialize, Serialize};

/// Non-negative integer paise (1 rupee = 100 paise), at most 2^53 - 1 so JSON clients keep exact values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(try_from = "i64", into = "i64")]
pub struct Paise(i64);

pub const MAX_PAISE: i64 = 9_007_199_254_740_991;

impl Paise {
    pub fn get(self) -> i64 {
        self.0
    }
}

impl TryFrom<i64> for Paise {
    type Error = String;
    fn try_from(v: i64) -> Result<Self, String> {
        if (0..=MAX_PAISE).contains(&v) {
            Ok(Paise(v))
        } else {
            Err(format!("paise out of range: {v}"))
        }
    }
}

impl From<Paise> for i64 {
    fn from(p: Paise) -> i64 {
        p.0
    }
}

/// Indian digit grouping for a rupee amount, for example 12000 -> "12,000" and 123456 -> "1,23,456".
fn group_indian(mut n: i64) -> String {
    if n < 1000 {
        return n.to_string();
    }
    let last3 = n % 1000;
    n /= 1000;
    let mut parts = vec![format!("{last3:03}")];
    while n >= 100 {
        parts.push(format!("{:02}", n % 100));
        n /= 100;
    }
    parts.push(n.to_string());
    parts.reverse();
    parts.join(",")
}

/// Display text for an amount in paise: crore (two decimals), lakh (up to two decimals, trailing zeros trimmed),
/// or grouped rupees. Values are truncated, not rounded, to the displayed precision.
pub fn format_inr(p: Paise) -> String {
    let paise = p.get();
    let rupees = paise / 100;
    if rupees >= 10_000_000 {
        let hundredths = paise / 10_000_000;
        return format!("₹{}.{:02} Cr", hundredths / 100, hundredths % 100);
    }
    if rupees >= 100_000 {
        let hundredths = paise / 100_000;
        let (whole, frac) = (hundredths / 100, hundredths % 100);
        return match frac {
            0 => format!("₹{whole} lakh"),
            f if f % 10 == 0 => format!("₹{whole}.{} lakh", f / 10),
            f => format!("₹{whole}.{f:02} lakh"),
        };
    }
    match paise % 100 {
        0 => format!("₹{}", group_indian(rupees)),
        r => format!("₹{}.{r:02}", group_indian(rupees)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(p: i64) -> String {
        format_inr(Paise::try_from(p).unwrap())
    }

    #[test]
    fn frozen_demo_amounts_format_correctly() {
        assert_eq!(f(250_000_000), "₹25 lakh"); // budget SYN-DEMO-BUD-001
        assert_eq!(f(180_000_000), "₹18 lakh"); // contract and work order
        assert_eq!(f(190_000_000), "₹19 lakh"); // tender estimate
        assert_eq!(f(120_000_000), "₹12 lakh"); // budget SYN-DEMO-BUD-002
        assert_eq!(f(1_200_000), "₹12,000"); // synthetic fresh repair estimate (potential, not savings)
    }

    #[test]
    fn crore_lakh_and_small_amounts() {
        // 1.80 crore is 18,000,000 rupees = 1,800,000,000 paise: ten times the 18 lakh work order.
        assert_eq!(f(1_800_000_000), "₹1.80 Cr");
        assert_eq!(f(2_000_000_000), "₹2.00 Cr");
        assert_eq!(f(185_000_000), "₹18.5 lakh");
        assert_eq!(f(182_500_000), "₹18.25 lakh");
        assert_eq!(f(0), "₹0");
        assert_eq!(f(99_999), "₹999.99");
        assert_eq!(f(9_999_900), "₹99,999");
        assert_eq!(f(12_345_600), "₹1.23 lakh");
        assert_eq!(f(1_234_500), "₹12,345");
        assert_eq!(f(5_050_000), "₹50,500");
    }

    #[test]
    fn invalid_paise_is_rejected() {
        assert!(Paise::try_from(-1).is_err());
        assert!(Paise::try_from(MAX_PAISE + 1).is_err());
        assert!(serde_json::from_str::<Paise>("-5").is_err());
        assert!(serde_json::from_str::<Paise>("1.5").is_err());
        assert_eq!(
            serde_json::from_str::<Paise>("180000000").unwrap().get(),
            180_000_000
        );
    }
}
