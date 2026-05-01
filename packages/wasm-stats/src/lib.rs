use serde::Serialize;
use wasm_bindgen::prelude::*;

mod aggregate;
mod clustering;
mod correlation;
mod descriptive;
mod outliers;
mod regression;
mod text;
mod timeseries;

fn to_value<T: Serialize>(value: &T) -> JsValue {
	serde_wasm_bindgen::to_value(value).unwrap_or(JsValue::NULL)
}

// ---------- descriptive ----------

#[wasm_bindgen]
pub fn summary(column: &[f64]) -> JsValue {
	to_value(&descriptive::summary(column))
}

#[wasm_bindgen]
pub fn histogram(column: &[f64], bin_count: usize) -> JsValue {
	to_value(&descriptive::histogram(column, bin_count.max(1)))
}

// ---------- regression ----------

#[wasm_bindgen]
pub fn linear_regression(x: &[f64], y: &[f64]) -> JsValue {
	to_value(&regression::linear(x, y))
}

#[wasm_bindgen]
pub fn polynomial_regression(x: &[f64], y: &[f64], degree: u8) -> JsValue {
	to_value(&regression::polynomial(x, y, degree as usize))
}

// ---------- outliers ----------

#[wasm_bindgen]
pub fn outliers_zscore(column: &[f64], threshold: f64) -> Vec<u32> {
	outliers::zscore(column, threshold)
}

#[wasm_bindgen]
pub fn outliers_iqr(column: &[f64], factor: f64) -> Vec<u32> {
	outliers::iqr(column, factor)
}

// ---------- time series ----------

#[wasm_bindgen]
pub fn detect_trend(values: &[f64]) -> JsValue {
	to_value(&timeseries::detect_trend(values))
}

#[wasm_bindgen]
pub fn detect_seasonality(values: &[f64], max_period: usize) -> JsValue {
	to_value(&timeseries::detect_seasonality(values, max_period))
}

#[wasm_bindgen]
pub fn change_points(values: &[f64], min_confidence: f64) -> JsValue {
	to_value(&timeseries::change_points(values, min_confidence))
}

// ---------- correlation ----------

#[wasm_bindgen]
pub fn correlation_pearson(a: &[f64], b: &[f64]) -> f64 {
	correlation::pearson(a, b)
}

#[wasm_bindgen]
pub fn correlation_matrix(columns: JsValue) -> JsValue {
	let cols: Vec<Vec<f64>> = serde_wasm_bindgen::from_value(columns).unwrap_or_default();
	let refs: Vec<&[f64]> = cols.iter().map(|c| c.as_slice()).collect();
	to_value(&correlation::matrix(&refs))
}

// ---------- clustering ----------

#[wasm_bindgen]
pub fn kmeans(data: JsValue, k: usize, max_iter: usize) -> JsValue {
	let cols: Vec<Vec<f64>> = serde_wasm_bindgen::from_value(data).unwrap_or_default();
	let refs: Vec<&[f64]> = cols.iter().map(|c| c.as_slice()).collect();
	to_value(&clustering::kmeans(&refs, k.max(1), max_iter.max(1)))
}

// ---------- aggregate ----------

#[wasm_bindgen]
pub fn group_by_sum(group_keys: &[u32], values: &[f64], group_count: usize) -> Vec<f64> {
	aggregate::group_by_sum(group_keys, values, group_count)
}

#[wasm_bindgen]
pub fn group_by_mean(group_keys: &[u32], values: &[f64], group_count: usize) -> Vec<f64> {
	aggregate::group_by_mean(group_keys, values, group_count)
}

#[wasm_bindgen]
pub fn group_by_count(group_keys: &[u32], group_count: usize) -> Vec<u32> {
	aggregate::group_by_count(group_keys, group_count)
}

// ---------- text ----------

#[wasm_bindgen]
pub fn tokenize(input: &str) -> JsValue {
	to_value(&text::tokenize(input))
}

#[wasm_bindgen]
pub fn term_frequency(docs: JsValue, top_n: usize) -> JsValue {
	let docs: Vec<String> = serde_wasm_bindgen::from_value(docs).unwrap_or_default();
	let refs: Vec<&str> = docs.iter().map(String::as_str).collect();
	to_value(&text::term_frequency(&refs, top_n.max(1)))
}

#[wasm_bindgen]
pub fn tf_idf(docs: JsValue, top_n: usize) -> JsValue {
	let docs: Vec<String> = serde_wasm_bindgen::from_value(docs).unwrap_or_default();
	let refs: Vec<&str> = docs.iter().map(String::as_str).collect();
	to_value(&text::tf_idf(&refs, top_n.max(1)))
}

#[wasm_bindgen]
pub fn rake_keywords(docs: JsValue, top_n: usize) -> JsValue {
	let docs: Vec<String> = serde_wasm_bindgen::from_value(docs).unwrap_or_default();
	let refs: Vec<&str> = docs.iter().map(String::as_str).collect();
	to_value(&text::rake_keywords(&refs, top_n.max(1)))
}

#[wasm_bindgen]
pub fn sentiment_score(input: &str) -> f64 {
	text::sentiment_score(input)
}

#[wasm_bindgen]
pub fn sentiment_batch(docs: JsValue) -> Vec<f64> {
	let docs: Vec<String> = serde_wasm_bindgen::from_value(docs).unwrap_or_default();
	docs.iter().map(|d| text::sentiment_score(d)).collect()
}

#[wasm_bindgen]
pub fn sentiment_summary(scores: &[f64], bin_count: usize) -> JsValue {
	to_value(&text::sentiment_summary(scores, bin_count.max(1)))
}
